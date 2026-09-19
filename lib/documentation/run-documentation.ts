// Doc 14 — the documentation agent. R1: runs after EVERY attempt, including
// NO_ANSWER/BUSY/VOICEMAIL/DROPPED/INVALID_NUMBER (transcript may be empty
// — the prompt module already handles that case). R3/R5: cheap structured
// output, verified against the transcript exactly like doc 12's triage
// pipeline — one repair attempt, then an explicit operational failure
// rather than a silent pass. R6: EHR write is a separate, non-fatal step —
// a synced-or-failed status is recorded either way, never silently dropped.

import type { AIProvider } from "../ai/providers/types";
import { runStructured } from "../ai/providers/managed-call";
import { ModelDocumentationOutputSchema, type DocumentationRecord } from "../ai/schemas/documentation";
import { documentationV1 } from "../ai/prompts/documentation/v1";
import { buildDocumentationContext } from "../ai/context/builders";
import { verifyDocumentationRefs, type TranscriptTurn } from "./verify";
import { createDocumentationRecord, markEhrSynced, markEhrFailed } from "../db/repositories/documentation-records";
import { mockEhrClient } from "../ehr/client";
import { EHRCallError } from "../ehr/types";
import type { TenantContext } from "../db/tenant";

export class DocumentationValidationFailedError extends Error {
  constructor(detail: string) {
    super(`DOCUMENTATION_VALIDATION_FAILED: ${detail}`);
    this.name = "DocumentationValidationFailedError";
  }
}

const MAX_REPAIR_ATTEMPTS = 1; // one repair attempt, same policy as doc 12 R3
const EHR_RETRY_BASE_MINUTES = 5;

export interface RunDocumentationAgentInput {
  ctx: TenantContext;
  provider: AIProvider;
  model: string;
  callId: string;
  patientId: string;
  campaignId: string;
  encounterId?: string;
  outcome: string;
  transcript: TranscriptTurn[];
  triage?: unknown;
  triageResultId?: string;
  escalation?: unknown;
  escalationId?: string;
  observationsRecorded?: string[];
  questionsAnswered: number;
  questionsTotal: number;
}

export async function runDocumentationAgent(input: RunDocumentationAgentInput) {
  const context = buildDocumentationContext(input.transcript, input.triage ?? null, input.escalation ?? null, input.outcome);
  let lastError = "";

  let modelOutput: { summary: string; patient_reported_symptoms: unknown[]; follow_up_actions: unknown[] } | null = null;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const prompt = attempt === 0 ? documentationV1.build(context) : `${documentationV1.build(context)}\n\nYour previous attempt was rejected: ${lastError}. Only report symptoms with a transcript_ref that actually points at real text in the transcript above.`;

    const managed = await runStructured(
      input.provider,
      input.model,
      { system: documentationV1.system, prompt, schema: ModelDocumentationOutputSchema },
      { ctx: input.ctx, agent: "documentation", purpose: "documentation", promptVersion: documentationV1.version, maxRetries: 0 },
    );

    if (!managed.ok) {
      if (managed.isValidationFailure) {
        lastError = managed.message;
        continue;
      }
      throw new Error(`PROVIDER_ERROR: ${managed.message}`);
    }

    const verification = verifyDocumentationRefs(managed.data.data, input.transcript);
    if (verification.valid) {
      modelOutput = managed.data.data;
      break;
    }
    lastError = verification.errors.join("; ");
  }

  if (!modelOutput) throw new DocumentationValidationFailedError(lastError);

  const result: DocumentationRecord = {
    schema_version: "1.0",
    call_id: input.callId,
    patient_id: input.patientId,
    campaign_id: input.campaignId,
    hospital_id: input.ctx.hospitalId,
    outcome: input.outcome,
    summary: modelOutput.summary,
    patient_reported_symptoms: modelOutput.patient_reported_symptoms as DocumentationRecord["patient_reported_symptoms"],
    observations_recorded: input.observationsRecorded ?? [],
    questions_answered: input.questionsAnswered,
    questions_total: input.questionsTotal,
    triage_result_id: input.triageResultId,
    escalation_id: input.escalationId,
    follow_up_actions: modelOutput.follow_up_actions as DocumentationRecord["follow_up_actions"],
    ehr_sync_status: "pending",
    generated_by: { model: input.model, prompt_version: documentationV1.version },
  };

  const row = await createDocumentationRecord(input.ctx, {
    callId: input.callId,
    patientId: input.patientId,
    campaignId: input.campaignId,
    result,
    modelProvider: input.provider.id,
    modelName: input.model,
    promptVersion: documentationV1.version,
  });

  // Doc 15 R4 — one write per call attempt, keyed so a retry (this call
  // again, or the background retry worker) replays instead of duplicating.
  // Called directly against the EHR client, not through the doc 09 tool
  // gateway: that gateway's protections (agent allowlist, audit logging
  // keyed to a real signed-in actor) exist to sandbox a model's own
  // tool-call attempts, and this write is issued by trusted orchestration
  // code after the model's output has already been validated, not by the
  // model itself — it never sees or requests this call.
  const idempotencyKey = `ehr-doc:${input.callId}`;
  try {
    await mockEhrClient.writeCommunication(
      input.ctx,
      { patientId: input.patientId, encounterId: input.encounterId, channel: "ehr_sync", direction: "OUTBOUND", content: result.summary },
      idempotencyKey,
    );
    await markEhrSynced(input.ctx, row.id, idempotencyKey);
    return { ...row, ehrSyncStatus: "SYNCED" as const };
  } catch (err) {
    const message = err instanceof EHRCallError ? err.message : err instanceof Error ? err.message : String(err);
    await markEhrFailed(input.ctx, row.id, idempotencyKey, message, new Date(Date.now() + EHR_RETRY_BASE_MINUTES * 60 * 1000));
    return { ...row, ehrSyncStatus: "FAILED" as const, ehrSyncError: message };
  }
}
