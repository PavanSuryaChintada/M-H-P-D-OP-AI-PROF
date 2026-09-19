// Doc 13 — ties the three assessors' outcomes to the consensus algorithm
// to persistence. The two LLM assessors' actual invocation (prompting,
// validation/repair pipeline) is doc 12's scope; this module accepts
// already-computed AssessorOutcome[] so it doesn't duplicate that
// pipeline, and it's directly testable against synthetic outcomes without
// a live model call.

import type { TenantContext } from "../db/tenant";
import type { AssessorOutcome, TriageResult } from "./schemas/triage";
import { computeConsensus, type ConsensusResult } from "./consensus";
import { createEscalationFromConsensus, type CreateEscalationInput } from "../db/repositories/escalations";
import { startEscalationNotificationChain } from "../events/handlers/escalation-notifications";

/**
 * Doc 13 §1 "Run all three assessors in parallel with Promise.allSettled.
 * A rejected or validation-failed assessor becomes an ASSESSOR_FAILURE
 * entry, not a thrown error." Each settler is expected to already have
 * done its own zod validation (doc 12 R3) and reject/resolve accordingly;
 * this just turns settlement outcomes into the AssessorOutcome union
 * consensus.ts consumes.
 */
export async function settleAssessors(
  runners: { assessorId: string; run: () => Promise<TriageResult> }[],
): Promise<AssessorOutcome[]> {
  const settled = await Promise.allSettled(runners.map((r) => r.run()));
  return settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") {
      return { assessorId: runners[i].assessorId, status: "completed", result: outcome.value };
    }
    return {
      assessorId: runners[i].assessorId,
      status: "failed",
      errorDetail: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    };
  });
}

export interface EscalateFromConsensusInput {
  patientId: string;
  campaignId?: string;
  callId?: string;
  outreachTaskId?: string;
  attemptNumber?: number;
}

export interface EscalateFromConsensusResult {
  consensus: ConsensusResult;
  escalationId: string | null;
}

/**
 * The primary doc 13 entry point: compute consensus over the three
 * assessor outcomes, and — only if the algorithm says to — persist an
 * escalation with all three assessments snapshotted, idempotently on
 * {outreachTaskId, attemptNumber}. No path here can suppress an
 * escalation the algorithm decided on; there is no downgrade step.
 */
export async function escalateFromConsensus(
  ctx: TenantContext,
  input: EscalateFromConsensusInput,
  outcomes: AssessorOutcome[],
): Promise<EscalateFromConsensusResult> {
  const consensus = computeConsensus(outcomes);

  if (!consensus.escalate) {
    return { consensus, escalationId: null };
  }

  const triggerReason =
    consensus.reason ??
    (consensus.ruleFired === 1
      ? "an assessor classified urgent"
      : consensus.ruleFired === 2
        ? "rule engine matched a high-severity red flag"
        : consensus.ruleFired === 6
          ? "majority of assessors classified concerning"
          : "default-safe: no rule explicitly cleared this case");

  const escalationInput: CreateEscalationInput = {
    patientId: input.patientId,
    campaignId: input.campaignId,
    callId: input.callId,
    outreachTaskId: input.outreachTaskId,
    attemptNumber: input.attemptNumber,
    triggerReason,
    clinicalIndicators: consensus.evidence,
    priority: consensus.priority === "HIGH" ? 3 : consensus.priority === "MEDIUM" ? 2 : 1,
  };

  const row = await createEscalationFromConsensus(ctx, escalationInput, outcomes, consensus);
  // Doc 16 R5 — kicks off the notification chain. Idempotent on
  // escalation id, so a retried call here is a safe no-op, not a
  // duplicate chain. No primaryReviewerUserId yet: assignment
  // (escalations.assignedTo) is doc 17's scope and happens after
  // creation, not at it — the chain still schedules its timeout-check
  // correctly either way, it just has no one to notify at the primary
  // stage until a reviewer is assigned.
  await startEscalationNotificationChain(ctx, row.id);
  return { consensus, escalationId: row.id };
}
