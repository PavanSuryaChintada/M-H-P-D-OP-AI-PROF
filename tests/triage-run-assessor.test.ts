// Doc 12 R3 — the validation pipeline against the live DB (triage_results
// persistence needs a real call/patient row): a malformed first response
// is repaired on the second attempt; two malformed responses in a row
// produce TRIAGE_VALIDATION_FAILED, an explicit failure, never a silent
// pass; a fabricated transcript quote goes through the same repair path
// as a schema failure. Also verifies the doc 12 -> doc 13 handoff: a
// twice-failed assessor becomes an ASSESSOR_FAILURE that the consensus
// algorithm escalates on (rule 4), end to end.

import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import { runTriageAssessor, TriageValidationFailedError } from "../lib/ai/triage/run-assessor";
import { settleAssessors } from "../lib/ai/run-consensus";
import { computeConsensus } from "../lib/ai/consensus";
import { MockProvider } from "../lib/ai/providers/mock";
import type { TenantContext } from "../lib/db/tenant";
import type { TriageResult } from "../lib/ai/schemas/triage";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false, ssl: "prefer" });

let hospital: { id: string };
let patientId: string;
let callId: string;
const ctx = (): TenantContext => ({
  hospitalId: hospital.id,
  userId: "00000000-0000-0000-0000-000000000000",
  role: "CLINICAL_REVIEWER",
});

const TRANSCRIPT = [
  { role: "agent", text: "How are you feeling since discharge?" },
  { role: "patient", text: "I've had some shortness of breath since yesterday." },
];

const VALID_RESULT: TriageResult = {
  schema_version: "1.0",
  assessor_id: "claude-triage-v1",
  classification: "concerning",
  confidence: 0.85,
  observations: [],
  indicators: [
    {
      indicator_id: "HF-01",
      description: "dyspnea",
      severity: "moderate",
      evidence: { turn_index: 1, excerpt: "shortness of breath" },
      protocol_reference: { chunk_id: "c1", protocol_id: "p1", version: "1" },
    },
  ],
  missing_information: [],
  escalation_recommended: true,
  reasoning_summary: "Patient reports dyspnea.",
};

const FABRICATED_QUOTE_RESULT: TriageResult = {
  ...VALID_RESULT,
  indicators: [
    {
      ...VALID_RESULT.indicators[0],
      evidence: { turn_index: 1, excerpt: "coughing up blood" }, // not in the transcript
    },
  ],
};

beforeAll(async () => {
  hospital = await createHospital({ name: "Triage Assessor Test Hospital", shortCode: `TAT-${Date.now()}`, timezone: "UTC" });
  const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospital.id}, 'TAT-P1', 'Tri', 'Age') returning id`;
  patientId = patient.id;
  const [campaign] = await admin`insert into campaigns (hospital_id, name, state, priority, max_retries) values (${hospital.id}, 'TAT Campaign', 'RUNNING', 1, 3) returning id`;
  const [task] = await admin`insert into outreach_tasks (hospital_id, campaign_id, patient_id, clinical_deadline_at, scheduled_for, max_attempts, risk_level, total_window_hours)
    values (${hospital.id}, ${campaign.id}, ${patientId}, now() + interval '1 day', now(), 3, 'MEDIUM', 24) returning id`;
  const [call] = await admin`insert into calls (hospital_id, outreach_task_id, campaign_id, patient_id, attempt_number, outcome)
    values (${hospital.id}, ${task.id}, ${campaign.id}, ${patientId}, 1, 'COMPLETED') returning id`;
  callId = call.id;
});

function runAssessor(provider: MockProvider) {
  return runTriageAssessor({
    assessorId: "claude-triage-v1",
    agentLabel: "clinical_triage",
    provider,
    model: "mock-model",
    system: "system prompt",
    buildPrompt: () => "user prompt",
    promptVersion: "test-v1",
    transcript: TRANSCRIPT,
    ctx: ctx(),
    callId,
    patientId,
  });
}

describe("runTriageAssessor — validation pipeline", () => {
  it("repairs a malformed (schema-invalid) first response on the second attempt", async () => {
    const provider = new MockProvider({ structuredResponses: [{ not: "a valid triage result" }, VALID_RESULT] });
    const result = await runAssessor(provider);
    expect(result.classification).toBe("concerning");
  });

  it("produces TRIAGE_VALIDATION_FAILED when two attempts in a row are malformed", async () => {
    const provider = new MockProvider({
      structuredResponses: [{ not: "valid" }, { also: "not valid" }],
    });
    await expect(runAssessor(provider)).rejects.toThrow(TriageValidationFailedError);
  });

  it("rejects a fabricated transcript quote and repairs it on the second attempt", async () => {
    const provider = new MockProvider({ structuredResponses: [FABRICATED_QUOTE_RESULT, VALID_RESULT] });
    const result = await runAssessor(provider);
    expect(result.indicators[0].evidence.excerpt).toBe("shortness of breath");
  });

  it("fails when the fabricated quote is never corrected", async () => {
    const provider = new MockProvider({ structuredResponses: [FABRICATED_QUOTE_RESULT, FABRICATED_QUOTE_RESULT] });
    await expect(runAssessor(provider)).rejects.toThrow(/excerpt/);
  });

  it("end to end: a twice-failed assessor becomes ASSESSOR_FAILURE and the consensus algorithm escalates on rule 4", async () => {
    const badProvider = new MockProvider({ structuredResponses: [{ bad: 1 }, { bad: 2 }] });
    const goodProvider = new MockProvider({ structuredResponses: [VALID_RESULT] });

    const outcomes = await settleAssessors([
      { assessorId: "claude-triage-v1", run: () => runAssessor(badProvider) },
      {
        assessorId: "gpt-triage-v1",
        run: () =>
          runTriageAssessor({
            assessorId: "gpt-triage-v1",
            agentLabel: "second_assessor",
            provider: goodProvider,
            model: "mock-model",
            system: "system prompt",
            buildPrompt: () => "user prompt",
            promptVersion: "test-v1",
            transcript: TRANSCRIPT,
            ctx: ctx(),
            callId,
            patientId,
          }),
      },
    ]);

    expect(outcomes.find((o) => o.assessorId === "claude-triage-v1")?.status).toBe("failed");

    const consensus = computeConsensus(outcomes);
    expect(consensus.escalate).toBe(true);
    expect(consensus.reason).toBe("ASSESSOR_FAILURE");
  });
});
