// Doc 13 §3/§4 — persistence against the live DB: an escalating consensus
// creates an escalation with all three assessment snapshots attached, a
// non-escalating consensus persists nothing, and escalation creation is
// idempotent per {outreach_task_id, attempt_number} — a retried call
// returns the same row rather than erroring or duplicating.

import { beforeAll, describe, expect, it } from "vitest";
import { createHospital } from "../lib/db/repositories/hospitals";
import { listAssessmentsForEscalation, getEscalationById } from "../lib/db/repositories/escalations";
import { escalateFromConsensus } from "../lib/ai/run-consensus";
import type { AssessorOutcome, TriageResult } from "../lib/ai/schemas/triage";
import type { TenantContext } from "../lib/db/tenant";
import postgres from "postgres";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false });

let hospital: { id: string };
let patientId: string;
let taskId: string;
const ctx = (): TenantContext => ({
  hospitalId: hospital.id,
  userId: "00000000-0000-0000-0000-000000000000",
  role: "CLINICAL_REVIEWER",
});

function triageResult(assessorId: string, overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    schema_version: "1.0",
    assessor_id: assessorId,
    classification: "routine",
    confidence: 0.9,
    observations: [],
    indicators: [],
    missing_information: [],
    escalation_recommended: false,
    reasoning_summary: "test",
    ...overrides,
  };
}

beforeAll(async () => {
  hospital = await createHospital({ name: "Consensus Integration Test Hospital", shortCode: `CIT-${Date.now()}`, timezone: "UTC" });
  const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospital.id}, 'CIT-P1', 'Con', 'Sensus') returning id`;
  patientId = patient.id;
  const [campaign] = await admin`insert into campaigns (hospital_id, name, state, priority, max_retries) values (${hospital.id}, 'CIT Campaign', 'RUNNING', 1, 3) returning id`;
  const [task] = await admin`insert into outreach_tasks (hospital_id, campaign_id, patient_id, clinical_deadline_at, scheduled_for, max_attempts, risk_level, total_window_hours)
    values (${hospital.id}, ${campaign.id}, ${patientId}, now() + interval '1 day', now(), 3, 'MEDIUM', 24) returning id`;
  taskId = task.id;
});

describe("escalateFromConsensus — persistence and idempotency", () => {
  it("does not create an escalation when consensus says not to (rule 7)", async () => {
    const outcomes: AssessorOutcome[] = [
      { assessorId: "claude-triage-v1", status: "completed", result: triageResult("claude-triage-v1") },
      { assessorId: "gpt-triage-v1", status: "completed", result: triageResult("gpt-triage-v1") },
      { assessorId: "rule-engine-v1", status: "completed", result: triageResult("rule-engine-v1", { confidence: 1.0 }) },
    ];
    const { consensus, escalationId } = await escalateFromConsensus(ctx(), { patientId, outreachTaskId: taskId, attemptNumber: 1 }, outcomes);
    expect(consensus.escalate).toBe(false);
    expect(escalationId).toBeNull();
  });

  it("creates an escalation with all three assessment snapshots when consensus escalates", async () => {
    const outcomes: AssessorOutcome[] = [
      { assessorId: "claude-triage-v1", status: "completed", result: triageResult("claude-triage-v1", { classification: "urgent" }) },
      { assessorId: "gpt-triage-v1", status: "completed", result: triageResult("gpt-triage-v1", { classification: "concerning" }) },
      { assessorId: "rule-engine-v1", status: "completed", result: triageResult("rule-engine-v1", { confidence: 1.0 }) },
    ];
    const { consensus, escalationId } = await escalateFromConsensus(ctx(), { patientId, outreachTaskId: taskId, attemptNumber: 2 }, outcomes);
    expect(consensus.escalate).toBe(true);
    expect(consensus.ruleFired).toBe(1);
    expect(escalationId).not.toBeNull();

    const escalation = await getEscalationById(ctx(), escalationId!);
    expect(escalation?.state).toBe("OPEN");
    expect(escalation?.attemptNumber).toBe(2);

    const assessments = await listAssessmentsForEscalation(ctx(), escalationId!);
    expect(assessments).toHaveLength(3);
    expect(assessments.map((a) => a.assessorId).sort()).toEqual(
      ["claude-triage-v1", "gpt-triage-v1", "rule-engine-v1"].sort(),
    );
  });

  it("records a failed assessor as its own snapshot row, not silently dropped", async () => {
    const outcomes: AssessorOutcome[] = [
      { assessorId: "claude-triage-v1", status: "completed", result: triageResult("claude-triage-v1") },
      { assessorId: "gpt-triage-v1", status: "failed", errorDetail: "timed out" },
      { assessorId: "rule-engine-v1", status: "completed", result: triageResult("rule-engine-v1", { confidence: 1.0 }) },
    ];
    const { escalationId } = await escalateFromConsensus(ctx(), { patientId, outreachTaskId: taskId, attemptNumber: 3 }, outcomes);
    const assessments = await listAssessmentsForEscalation(ctx(), escalationId!);
    const failedRow = assessments.find((a) => a.assessorId === "gpt-triage-v1");
    expect(failedRow?.status).toBe("failed");
    expect(failedRow?.errorDetail).toBe("timed out");
    expect(failedRow?.classification).toBeNull();
  });

  it("is idempotent per {outreachTaskId, attemptNumber} — a retried call returns the same escalation, not a duplicate", async () => {
    const outcomes: AssessorOutcome[] = [
      { assessorId: "claude-triage-v1", status: "completed", result: triageResult("claude-triage-v1", { classification: "urgent" }) },
      { assessorId: "gpt-triage-v1", status: "completed", result: triageResult("gpt-triage-v1") },
      { assessorId: "rule-engine-v1", status: "completed", result: triageResult("rule-engine-v1", { confidence: 1.0 }) },
    ];
    const first = await escalateFromConsensus(ctx(), { patientId, outreachTaskId: taskId, attemptNumber: 4 }, outcomes);
    const second = await escalateFromConsensus(ctx(), { patientId, outreachTaskId: taskId, attemptNumber: 4 }, outcomes);

    expect(second.escalationId).toBe(first.escalationId);

    const assessments = await listAssessmentsForEscalation(ctx(), first.escalationId!);
    expect(assessments).toHaveLength(3); // not 6 — the retry didn't re-insert
  });
});
