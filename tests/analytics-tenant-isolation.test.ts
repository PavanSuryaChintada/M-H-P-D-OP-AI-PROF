// Doc 18's required test: "analytics under Hospital A context never counts
// Hospital B rows." Seeds parallel fixtures (campaign, task, escalation) in
// two hospitals and checks every analytics function scoped to Hospital A
// reports only Hospital A's numbers, even though Hospital B has real,
// larger data that would show up immediately if any query were missing its
// hospital_id filter.

import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import { getCampaignProgress, getCapacityGauge, getRetryBacklogCount } from "../lib/analytics/campaign-manager";
import { getHospitalOverview, getEscalationCounts, getManualFollowUpBacklogCount } from "../lib/analytics/hospital-admin";
import { createEscalation } from "../lib/db/repositories/escalations";
import type { TenantContext } from "../lib/db/tenant";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false, ssl: "prefer" });

let hospitalA: { id: string };
let hospitalB: { id: string };
let campaignA: string;
let campaignB: string;
const ctxA = (): TenantContext => ({ hospitalId: hospitalA.id, userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" });
const ctxB = (): TenantContext => ({ hospitalId: hospitalB.id, userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" });

async function seedCampaignWithTasks(hospitalId: string, campaignId: string, taskCount: number, state: string) {
  const label = `${state}-${Date.now()}`; // distinct per call, so two calls for the same hospital (different states) never collide on mrn
  for (let i = 0; i < taskCount; i++) {
    const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospitalId}, ${"AN-" + label + "-" + i}, 'An', 'Test') returning id`;
    await admin`insert into outreach_tasks (hospital_id, campaign_id, patient_id, clinical_deadline_at, scheduled_for, max_attempts, risk_level, total_window_hours, state, attempt_count)
      values (${hospitalId}, ${campaignId}, ${patient.id}, now() + interval '1 day', now(), 3, 'MEDIUM', 24, ${state}, 1)`;
  }
}

beforeAll(async () => {
  const suffix = Date.now();
  hospitalA = await createHospital({ name: "Analytics Test Hospital A", shortCode: `ANA-${suffix}`, timezone: "UTC" });
  hospitalB = await createHospital({ name: "Analytics Test Hospital B", shortCode: `ANB-${suffix}`, timezone: "UTC" });

  const [ca] = await admin`insert into campaigns (hospital_id, name, state, priority, max_retries) values (${hospitalA.id}, 'A Campaign', 'RUNNING', 1, 3) returning id`;
  const [cb] = await admin`insert into campaigns (hospital_id, name, state, priority, max_retries) values (${hospitalB.id}, 'B Campaign', 'RUNNING', 1, 3) returning id`;
  campaignA = ca.id;
  campaignB = cb.id;

  // Hospital B gets deliberately MORE data than A — if any query is
  // missing its hospital_id filter, A's numbers would visibly inflate.
  await seedCampaignWithTasks(hospitalA.id, campaignA, 2, "COMPLETED");
  await seedCampaignWithTasks(hospitalB.id, campaignB, 10, "COMPLETED");
  await seedCampaignWithTasks(hospitalB.id, campaignB, 5, "MANUAL_FOLLOW_UP");
  // No hospital_capacity row is auto-created by createHospital — insert one
  // rather than update (an update against a nonexistent row silently
  // matches zero rows, which is exactly the kind of thing this test exists
  // to catch elsewhere, so it shouldn't slip past in its own fixture).
  await admin`insert into hospital_capacity (hospital_id, current_active_calls, max_concurrent_calls) values (${hospitalB.id}, 7, 20)`;

  const [patientA] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospitalA.id}, 'ANA-ESC', 'Esc', 'A') returning id`;
  const [patientB] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospitalB.id}, 'ANB-ESC', 'Esc', 'B') returning id`;
  await createEscalation(ctxA(), { patientId: patientA.id, triggerReason: "test", priority: 2 });
  for (let i = 0; i < 4; i++) {
    await createEscalation(ctxB(), { patientId: patientB.id, triggerReason: "test", priority: 3 });
  }
}, 30000);

describe("doc 18 — analytics tenant isolation", () => {
  it("getCampaignProgress under Hospital A never counts Hospital B's tasks", async () => {
    const progress = await getCampaignProgress(ctxA(), campaignA);
    expect(progress.completed).toBe(2);
    expect(progress.manual).toBe(0); // Hospital B has 5 MANUAL_FOLLOW_UP — must not leak in
  });

  it("getCapacityGauge under Hospital A never reports Hospital B's capacity", async () => {
    const gaugeA = await getCapacityGauge(ctxA());
    const gaugeB = await getCapacityGauge(ctxB());
    expect(gaugeB.active).toBe(7); // sanity: B really does have different data
    expect(gaugeA.active).not.toBe(7);
  });

  it("getHospitalOverview under Hospital A never counts Hospital B's campaigns or calls", async () => {
    const overviewA = await getHospitalOverview(ctxA());
    expect(overviewA.campaignCount).toBe(1); // not 2 — B's campaign must not be counted
  });

  it("getEscalationCounts under Hospital A never counts Hospital B's escalations", async () => {
    const countsA = await getEscalationCounts(ctxA());
    const totalA = countsA.byPriorityAndStatus.reduce((sum, r) => sum + r.count, 0);
    expect(totalA).toBe(1); // not 5 — B's 4 escalations must not leak in
  });

  it("getManualFollowUpBacklogCount and getRetryBacklogCount under Hospital A are zero despite Hospital B having real backlog", async () => {
    expect(await getManualFollowUpBacklogCount(ctxA())).toBe(0);
    expect(await getRetryBacklogCount(ctxA())).toBe(0);
  });
});
