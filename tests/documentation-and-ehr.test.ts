// Doc 14/15 required tests: a NO_ANSWER (empty transcript) attempt still
// produces a documentation record; a fabricated symptom (transcript_ref
// pointing outside the real transcript) is rejected rather than silently
// accepted; an EHR failure surfaces as `FAILED` (never silently dropped)
// and the retry worker successfully syncs it once the mock EHR recovers.

import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital, updateHospitalConfig } from "../lib/db/repositories/hospitals";
import { HospitalConfigSchema } from "../lib/hospitals/config-schema";
import { runDocumentationAgent, DocumentationValidationFailedError } from "../lib/documentation/run-documentation";
import { retryFailedEhrSyncs } from "../lib/ehr/retry-worker";
import { MockProvider } from "../lib/ai/providers/mock";
import type { TenantContext } from "../lib/db/tenant";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false, ssl: "prefer" });

const baseConfig = (failureRate: number) =>
  HospitalConfigSchema.parse({
    callingHours: { MON: { start: "00:00", end: "23:59" } },
    maxConcurrentCalls: 10,
    defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60], jitterPct: 10 },
    defaultFollowUpWindowHours: 168,
    notificationPreferences: { channels: ["IN_APP"], reviewerTimeoutMinutes: 30 },
    ehrSettings: { mode: "mock", failureRate },
  });

let hospital: { id: string };
let campaignId: string;
const ctx = (): TenantContext => ({ hospitalId: hospital.id, userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" });

async function seedPatientAndCall(mrn: string, outcome: string) {
  const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospital.id}, ${mrn}, 'Doc', 'Test') returning id`;
  const [task] = await admin`insert into outreach_tasks (hospital_id, campaign_id, patient_id, clinical_deadline_at, scheduled_for, max_attempts, risk_level, total_window_hours)
    values (${hospital.id}, ${campaignId}, ${patient.id}, now() + interval '1 day', now(), 3, 'MEDIUM', 24) returning id`;
  const [call] = await admin`insert into calls (hospital_id, outreach_task_id, campaign_id, patient_id, attempt_number, outcome)
    values (${hospital.id}, ${task.id}, ${campaignId}, ${patient.id}, 1, ${outcome}) returning id`;
  return { patientId: patient.id as string, callId: call.id as string };
}

beforeAll(async () => {
  hospital = await createHospital({ name: "Documentation/EHR Test Hospital", shortCode: `DEH-${Date.now()}`, timezone: "UTC" });
  const [campaign] = await admin`insert into campaigns (hospital_id, name, state, priority, max_retries) values (${hospital.id}, 'DEH Campaign', 'RUNNING', 1, 3) returning id`;
  campaignId = campaign.id;
});

describe("documentation agent (doc 14)", () => {
  it("a NO_ANSWER attempt with an empty transcript still produces a documentation record", async () => {
    await updateHospitalConfig(hospital.id, baseConfig(0));
    const { patientId, callId } = await seedPatientAndCall("DEH-P1", "NO_ANSWER");
    const provider = new MockProvider({
      structuredResponses: [{ summary: "Call did not connect (no answer).", patient_reported_symptoms: [], follow_up_actions: [] }],
    });

    const row = await runDocumentationAgent({
      ctx: ctx(),
      provider,
      model: "mock",
      callId,
      patientId,
      campaignId,
      outcome: "NO_ANSWER",
      transcript: [],
      questionsAnswered: 0,
      questionsTotal: 2,
    });

    expect(row.summary).toContain("did not connect");
    expect(row.ehrSyncStatus).toBe("SYNCED");
  }, 30000);

  it("a fabricated symptom (transcript_ref pointing outside the real transcript) is rejected, not silently accepted", async () => {
    await updateHospitalConfig(hospital.id, baseConfig(0));
    const { patientId, callId } = await seedPatientAndCall("DEH-P2", "COMPLETED");
    const transcript = [
      { role: "agent", text: "How are you feeling?" },
      { role: "patient", text: "I'm doing fine, thanks." },
    ];
    // Both attempts (initial + the one repair) claim a symptom quote that
    // does not exist in the transcript above — must fail closed, not pass.
    const fabricated = {
      summary: "Patient reported severe chest pain.",
      patient_reported_symptoms: [
        { symptom: "chest pain", transcript_ref: { turn_index: 1, quote_span: [0, 500] } }, // out of bounds
      ],
      follow_up_actions: [],
    };
    const provider = new MockProvider({ structuredResponses: [fabricated, fabricated] });

    await expect(
      runDocumentationAgent({
        ctx: ctx(),
        provider,
        model: "mock",
        callId,
        patientId,
        campaignId,
        outcome: "COMPLETED",
        transcript,
        questionsAnswered: 1,
        questionsTotal: 1,
      }),
    ).rejects.toThrow(DocumentationValidationFailedError);
  }, 30000);
});

describe("mock EHR failure injection and retry (doc 15)", () => {
  it("an EHR failure surfaces as FAILED (never silently dropped) and the retry worker syncs it once the EHR recovers", async () => {
    await updateHospitalConfig(hospital.id, baseConfig(1)); // force every mock EHR write to fail
    const { patientId, callId } = await seedPatientAndCall("DEH-P3", "COMPLETED");
    const provider = new MockProvider({
      structuredResponses: [{ summary: "Patient is recovering well.", patient_reported_symptoms: [], follow_up_actions: [] }],
    });

    const row = await runDocumentationAgent({
      ctx: ctx(),
      provider,
      model: "mock",
      callId,
      patientId,
      campaignId,
      outcome: "COMPLETED",
      transcript: [{ role: "patient", text: "I'm doing well." }],
      questionsAnswered: 0,
      questionsTotal: 0,
    });

    expect(row.ehrSyncStatus).toBe("FAILED");
    expect(row.ehrSyncError).toBeTruthy();

    // Mock EHR recovers; the retry worker should pick this record up and
    // sync it. `now` is pushed past the backoff window (see retry-worker.ts)
    // rather than actually waiting real minutes in a test.
    await updateHospitalConfig(hospital.id, baseConfig(0));
    const retryResult = await retryFailedEhrSyncs(hospital.id, new Date(Date.now() + 10 * 60 * 1000));
    expect(retryResult.synced).toBeGreaterThanOrEqual(1);

    const [refetched] = await admin`select ehr_sync_status from documentation_records where id = ${row.id}`;
    expect(refetched.ehr_sync_status).toBe("SYNCED");
  }, 30000);
});
