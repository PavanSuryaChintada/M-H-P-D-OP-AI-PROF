// Doc 12 R3 — the validation pipeline: structured output (schema-validated
// inside generateStructured already) -> transcript-ref/grounding check ->
// on failure, ONE repair attempt with the validation error fed back into a
// fresh prompt -> a second failure is TRIAGE_VALIDATION_FAILED, an
// explicit operational failure, never a silent pass. Thrown here; the
// caller (lib/ai/run-consensus.ts's settleAssessors, via
// Promise.allSettled) turns that into an ASSESSOR_FAILURE outcome doc 13's
// consensus algorithm already knows how to handle (rule 4) — no new
// escalation path needed, the existing one does the job.

import type { AIProvider } from "../providers/types";
import { runStructured } from "../providers/managed-call";
import { TriageResultSchema, type TriageResult } from "../schemas/triage";
import { verifyTranscriptRefs, type TranscriptTurn } from "./verify";
import { applyUncertaintyForcing, type UncertaintyForcingOptions } from "./uncertainty";
import { createTriageResult } from "../../db/repositories/triage-results";
import type { TenantContext } from "../../db/tenant";

export class TriageValidationFailedError extends Error {
  constructor(detail: string) {
    super(`TRIAGE_VALIDATION_FAILED: ${detail}`);
    this.name = "TriageValidationFailedError";
  }
}

export interface RunTriageAssessorInput {
  assessorId: string;
  provider: AIProvider;
  model: string;
  system: string;
  /** builds the user prompt; called again on repair with the validation error appended */
  buildPrompt: (repairContext?: { previousError: string }) => string;
  promptVersion: string;
  transcript: TranscriptTurn[];
  ctx: TenantContext;
  callId: string;
  patientId: string;
  uncertaintyOptions?: UncertaintyForcingOptions;
  /** doc 09's ai_usage recording needs an agent label distinct from the shared assessorId string */
  agentLabel: string;
}

const MAX_REPAIR_ATTEMPTS = 1; // one repair attempt, per doc 12 R3

export async function runTriageAssessor(input: RunTriageAssessorInput): Promise<TriageResult> {
  let lastError = "";
  let attempts = 0;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    attempts++;
    const prompt = attempt === 0 ? input.buildPrompt() : input.buildPrompt({ previousError: lastError });

    const managed = await runStructured(
      input.provider,
      input.model,
      { system: input.system, prompt, schema: TriageResultSchema },
      {
        ctx: input.ctx,
        agent: input.agentLabel,
        purpose: "clinical_triage",
        promptVersion: input.promptVersion,
        // Retries are this loop's job (with the error fed back into the
        // next prompt), not managed-call's generic retry-the-same-prompt
        // policy — those are different failure classes.
        maxRetries: 0,
      },
    );

    if (!managed.ok) {
      if (managed.isValidationFailure) {
        // Doc 12 R3's "JSON parse -> fail -> repair; zod validate -> fail
        // -> repair" step: a schema-shape failure is exactly as repairable
        // as a transcript-ref failure, so it feeds into the same loop
        // rather than being treated as an unrecoverable provider error.
        lastError = managed.message;
        continue;
      }
      // A genuine provider/network failure, not a validation failure —
      // there's nothing to repair against; surface it as-is.
      throw new Error(`PROVIDER_ERROR: ${managed.message}`);
    }

    const verification = verifyTranscriptRefs(managed.data.data, input.transcript);
    if (verification.valid) {
      const { result } = applyUncertaintyForcing(managed.data.data, input.uncertaintyOptions);

      await createTriageResult(input.ctx, {
        callId: input.callId,
        patientId: input.patientId,
        result,
        modelProvider: input.provider.id,
        modelName: input.model,
        promptVersion: input.promptVersion,
        rawOutput: managed.data.data,
        validationAttempts: attempts,
      });

      return result;
    }

    lastError = verification.errors.join("; ");
  }

  throw new TriageValidationFailedError(lastError);
}
