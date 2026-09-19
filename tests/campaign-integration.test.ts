// Doc 05 acceptance criteria, against the live DB:
//  - "Pausing a RUNNING campaign with active calls: no new claims occur,
//    all [active calls] complete" — doc 06 owns the scheduler's claim
//    query; this proves doc 05's half of the contract: pausing never
//    touches existing outreach_task rows, which is what makes that
//    guarantee possible once doc 06 exists.
//  - "Clicking any excluded patient shows the exact failing rule."

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import { createUser } from "../lib/db/repositories/users";
import { createCampaign, getCampaignById } from "../lib/db/repositories/campaigns";
import { getEvaluation } from "../lib/db/repositories/eligibility";
import { transitionCampaign } from "../lib/campaigns/transition";
import { evaluatePatientForCampaign } from "../lib/campaigns/evaluate";
import { ingestDischargeRecord } from "../lib/discharge/ingest";
import type { TenantContext } from "../lib/db/tenant";

const admin = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: "require" });

let hospital: { id: string };
let actor: { id: string };
let ctx: TenantContext;

beforeAll(async () => {
  hospital = await createHospital({
    name: "Campaign Test Hospital",
    shortCode: `CAMP-${Date.now()}`,
    timezone: "Asia/Kolkata",
  });
  actor = await createUser({ email: `campaign-test-${Date.now()}@rbac-test.local`, displayName: "Campaign Test Actor" });
  ctx = { hospitalId: hospital.id, userId: actor.id, role: "HOSPITAL_ADMIN" };
});

afterAll(async () => {
  if (hospital) {
    await admin`delete from outreach_tasks where hospital_id = ${hospital.id}`;
    await admin`delete from eligibility_evaluations where hospital_id = ${hospital.id}`;
    await admin`delete from campaign_state_transitions where hospital_id = ${hospital.id}`;
    await admin`delete from campaigns where hospital_id = ${hospital.id}`;
    await admin`delete from encounters where hospital_id = ${hospital.id}`;
    await admin`delete from patients where hospital_id = ${hospital.id}`;
    await admin`delete from events where hospital_id = ${hospital.id}`;
  }
  // Every transitionCampaign() call writes an audit_log row with this
  // hospital/actor as FKs (not just a text reference), same as the
  // append-only pattern seen in tests/tenancy.test.ts — once that's
  // happened, both rows are permanently undeletable by design. Tolerate it
  // rather than fail cleanup over a guarantee working as intended.
  if (actor) await admin`delete from users where id = ${actor.id}`.catch(() => {});
  if (hospital) await admin`delete from hospitals where id = ${hospital.id}`.catch(() => {});
  await admin.end();
});

describe("campaign lifecycle + eligibility, end to end", () => {
  it(
    "READY -> RUNNING recomputes eligibility, and the drill-down shows the exact failing rule",
    async () => {
      // One eligible patient (usable phone, matches risk criteria), one
      // ineligible (invalid phone sentinel from doc 04's own convention).
      const eligible = await ingestDischargeRecord(ctx, {
        sourceMessageId: "CAMP-DISCH-1",
        patient: { mrn: "CAMP-P1", firstName: "Elig", lastName: "Ible", phone: "+15550001111" },
        encounter: { dischargeAt: new Date().toISOString() },
        riskLevel: "HIGH",
        followUpWindowHours: 72,
        conditions: [],
        observations: [],
        medications: [],
      });
      const ineligible = await ingestDischargeRecord(ctx, {
        sourceMessageId: "CAMP-DISCH-2",
        patient: { mrn: "CAMP-P2", firstName: "Not", lastName: "Eligible", phone: "000-000-0000" },
        encounter: { dischargeAt: new Date().toISOString() },
        riskLevel: "HIGH",
        followUpWindowHours: 72,
        conditions: [],
        observations: [],
        medications: [],
      });

      const campaign = await createCampaign(ctx, {
        name: "High Risk Follow-up",
        eligibilityCriteria: { riskLevels: ["HIGH", "CRITICAL"] },
        maxRetries: 2,
      });

      await transitionCampaign(ctx, campaign.id, "READY", "config complete");
      await transitionCampaign(ctx, campaign.id, "RUNNING", "launch");

      const updated = await getCampaignById(ctx, campaign.id);
      expect(updated?.state).toBe("RUNNING");

      const eligibleEval = await getEvaluation(ctx, campaign.id, eligible.patientId);
      expect(eligibleEval?.status).toBe("ELIGIBLE");

      const ineligibleEval = await getEvaluation(ctx, campaign.id, ineligible.patientId);
      expect(ineligibleEval?.status).toBe("INELIGIBLE");
      const failingRule = (ineligibleEval?.ruleResults as { ruleId: string; passed: boolean }[]).find(
        (r) => !r.passed,
      );
      expect(failingRule?.ruleId).toBe("hasUsableContact");
    },
    30000,
  );

  it(
    "pausing does not touch existing outreach_task rows",
    async () => {
      const campaign = await createCampaign(ctx, { name: "Pause Test Campaign" });
      await transitionCampaign(ctx, campaign.id, "READY", "setup");
      await transitionCampaign(ctx, campaign.id, "RUNNING", "launch");

      const patient = await ingestDischargeRecord(ctx, {
        sourceMessageId: "CAMP-DISCH-PAUSE",
        patient: { mrn: "CAMP-PAUSE-1", firstName: "Active", lastName: "Call" },
        encounter: { dischargeAt: new Date().toISOString() },
        riskLevel: "LOW",
        followUpWindowHours: 72,
        conditions: [],
        observations: [],
        medications: [],
      });

      // Simulate an in-flight call the scheduler (doc 06) would own — doc
      // 05 only needs to prove it never touches this row on pause.
      const [task] = await admin`
        insert into outreach_tasks (hospital_id, campaign_id, patient_id, state, clinical_deadline_at)
        values (${hospital.id}, ${campaign.id}, ${patient.patientId}, 'CALLING', now() + interval '1 day')
        returning id, state, updated_at
      `;

      await transitionCampaign(ctx, campaign.id, "PAUSED", "operator paused");

      const [taskAfterPause] = await admin`select state, updated_at from outreach_tasks where id = ${task.id}`;
      expect(taskAfterPause.state).toBe("CALLING");
      expect(new Date(taskAfterPause.updated_at).getTime()).toBe(new Date(task.updated_at).getTime());

      const updated = await getCampaignById(ctx, campaign.id);
      expect(updated?.state).toBe("PAUSED");
    },
    30000,
  );

  it("returns null (not a crash) for a patient id that doesn't exist at all", async () => {
    // Found via this test: eligibility_evaluations.patient_id has a hard FK,
    // so there is no valid row to persist for an id that was never real —
    // R6's "never silently drop a patient" is about patients that exist,
    // not about tolerating bogus ids. The caller (route handlers) turns
    // null into 404.
    const campaign = await createCampaign(ctx, { name: "Error Path Campaign" });
    const result = await evaluatePatientForCampaign(ctx, campaign, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});
