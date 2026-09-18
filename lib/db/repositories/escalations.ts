// Doc 09/13/17 — escalations. Doc 13 needs enough here to persist a
// consensus decision idempotently, with all three assessors' snapshots as
// child rows; the guarded OPEN->ASSIGNED->...->CLOSED lifecycle and the
// reviewer UI are doc 17's scope.

import { and, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { escalations, escalationStateTransitions, escalationAssessments } from "../schema";
import type { AssessorOutcome } from "../../ai/schemas/triage";
import type { ConsensusResult } from "../../ai/consensus";

export interface CreateEscalationInput {
  patientId: string;
  campaignId?: string;
  callId?: string;
  /** Doc 13 §4/deliverable 5 — together with attemptNumber, this is the idempotency key. Omit only for escalation sources doc 13 doesn't cover (there are none yet — every escalation today originates from a call attempt). */
  outreachTaskId?: string;
  attemptNumber?: number;
  triggerReason: string;
  clinicalIndicators?: unknown;
  consensusResult?: unknown;
  priority: number;
}

/** The only writer of escalations.state should end up being doc 17's guarded transition function once it exists; this creates the initial OPEN row. Idempotent on (outreachTaskId, attemptNumber) via the unique index — a retried call returns the row that already exists rather than erroring or duplicating. */
export async function createEscalation(ctx: TenantContext, input: CreateEscalationInput) {
  return withTenant(ctx, async (tx) => {
    const [inserted] = await tx
      .insert(escalations)
      .values({ ...input, hospitalId: ctx.hospitalId, state: "OPEN" })
      .onConflictDoNothing({ target: [escalations.outreachTaskId, escalations.attemptNumber] })
      .returning();

    if (inserted) {
      await tx.insert(escalationStateTransitions).values({
        escalationId: inserted.id,
        hospitalId: ctx.hospitalId,
        fromState: null,
        toState: "OPEN",
        reason: input.triggerReason,
        actor: `system:${ctx.userId}`,
      });
      return { row: inserted, created: true as const };
    }

    // Conflict — the escalation for this {task, attempt} already exists.
    const [existing] = await tx
      .select()
      .from(escalations)
      .where(
        and(
          eq(escalations.outreachTaskId, input.outreachTaskId!),
          eq(escalations.attemptNumber, input.attemptNumber!),
        ),
      );
    return { row: existing, created: false as const };
  });
}

/** Doc 13 §3 — snapshots all three assessor outcomes as child rows, tagged with the severity rank the consensus algorithm computed for each. Called once, only when createEscalation actually inserted a new row (never re-recorded on a retried/idempotent call). */
export async function recordEscalationAssessments(
  ctx: TenantContext,
  escalationId: string,
  outcomes: AssessorOutcome[],
) {
  return withTenant(ctx, async (tx) => {
    const SEVERITY_RANK: Record<string, number> = { routine: 0, concerning: 1, uncertain: 2, urgent: 3 };
    // TriageResult (doc 12 R1) uses lowercase classifications; the DB enum
    // (doc 01, predating doc 12's spec) uses uppercase. Map at the
    // persistence boundary rather than changing either spec.
    const CLASSIFICATION_TO_DB: Record<string, "ROUTINE" | "CONCERNING" | "URGENT" | "UNCERTAIN"> = {
      routine: "ROUTINE",
      concerning: "CONCERNING",
      urgent: "URGENT",
      uncertain: "UNCERTAIN",
    };
    const rows = outcomes.map((outcome) =>
      outcome.status === "completed"
        ? {
            hospitalId: ctx.hospitalId,
            escalationId,
            assessorId: outcome.assessorId,
            status: "completed" as const,
            classification: CLASSIFICATION_TO_DB[outcome.result.classification],
            confidence: String(outcome.result.confidence),
            severityRank: SEVERITY_RANK[outcome.result.classification],
            observedIndicators: outcome.result.indicators,
            evidence: outcome.result.observations,
          }
        : {
            hospitalId: ctx.hospitalId,
            escalationId,
            assessorId: outcome.assessorId,
            status: "failed" as const,
            errorDetail: outcome.errorDetail,
          },
    );
    return tx.insert(escalationAssessments).values(rows).returning();
  });
}

/** Doc 13's primary write path: creates the escalation (idempotent) and, only on a genuinely new escalation, records the assessment snapshots and the consensus's evidence/rule-fired detail onto the row. */
export async function createEscalationFromConsensus(
  ctx: TenantContext,
  input: CreateEscalationInput,
  outcomes: AssessorOutcome[],
  consensus: ConsensusResult,
) {
  const { row, created } = await createEscalation(ctx, {
    ...input,
    consensusResult: {
      ruleFired: consensus.ruleFired,
      reason: consensus.reason,
      disagreement: consensus.disagreement,
      disagreementDetail: consensus.disagreementDetail,
      evidence: consensus.evidence,
    },
  });
  if (created) {
    await recordEscalationAssessments(ctx, row.id, outcomes);
  }
  return row;
}

export async function getEscalationById(ctx: TenantContext, escalationId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(escalations).where(eq(escalations.id, escalationId));
    return row ?? null;
  });
}

export async function listEscalationsForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) => tx.select().from(escalations).where(eq(escalations.patientId, patientId)));
}

export async function listAssessmentsForEscalation(ctx: TenantContext, escalationId: string) {
  return withTenant(ctx, async (tx) =>
    tx.select().from(escalationAssessments).where(eq(escalationAssessments.escalationId, escalationId)),
  );
}
