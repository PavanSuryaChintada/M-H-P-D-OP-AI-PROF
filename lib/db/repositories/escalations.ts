// Doc 09/13/17 — escalations. Doc 13 needs enough here to persist a
// consensus decision idempotently, with all three assessors' snapshots as
// child rows; the guarded OPEN->ASSIGNED->...->CLOSED lifecycle and the
// reviewer UI are doc 17's scope.

import { and, asc, eq, ne } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { escalations, escalationStateTransitions, escalationAssessments, escalationResolutionOutcomeEnum } from "../schema";
import type { AssessorOutcome } from "../../ai/schemas/triage";
import type { ConsensusResult } from "../../ai/consensus";
import { writeAuditLog } from "./audit";
import { type EscalationState, assertValidEscalationTransition, isValidEscalationTransition } from "../../escalations/lifecycle";

export type EscalationResolutionOutcome = (typeof escalationResolutionOutcomeEnum.enumValues)[number];

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

const TERMINAL_OR_ACKNOWLEDGED_STATES: (typeof escalations.$inferSelect)["state"][] = [
  "ACKNOWLEDGED",
  "RESOLVED",
  "CLOSED",
  "OVERDUE",
];

/**
 * Doc 17 R1/R6 — the one place escalations.state is ever written after
 * creation: validates the transition (lib/escalations/lifecycle.ts),
 * writes the row, logs a transition row, and writes an audit entry with
 * before/after state. Also stamps acknowledged_at + time_to_acknowledge on
 * the FIRST move out of OPEN (R2/R7), and resolved_at + time_to_resolve on
 * a move into RESOLVED — whichever of ACKNOWLEDGED/ASSIGNED happens first
 * is "acknowledgement" for SLA purposes, since both mean a human or the
 * system noticed it.
 */
export async function transitionEscalationState(
  ctx: TenantContext,
  escalationId: string,
  to: EscalationState,
  reason: string,
  actor: string,
  extra: {
    assignedTo?: string | null;
    resolution?: string;
    resolutionOutcome?: EscalationResolutionOutcome;
    /** Doc 16's automated timeout-chain transitions (ACKNOWLEDGED/OVERDUE) are not a human action — R6 only requires an audit row for human actions, and the chain runs under a synthetic system actor with no real users.id to satisfy audit_log's FK anyway. */
    skipAudit?: boolean;
  } = {},
) {
  return withTenant(ctx, async (tx) => {
    const [current] = await tx.select().from(escalations).where(eq(escalations.id, escalationId));
    if (!current) return null;
    const from = current.state as EscalationState;
    assertValidEscalationTransition(from, to);

    const now = new Date();
    const setValues: Record<string, unknown> = { state: to };
    if (extra.assignedTo !== undefined) setValues.assignedTo = extra.assignedTo;
    if (extra.resolution !== undefined) setValues.resolution = extra.resolution;
    if (extra.resolutionOutcome !== undefined) setValues.resolutionOutcome = extra.resolutionOutcome;

    if (!current.acknowledgedAt && (to === "ACKNOWLEDGED" || to === "ASSIGNED")) {
      setValues.acknowledgedAt = now;
      setValues.timeToAcknowledgeSeconds = Math.round((now.getTime() - current.createdAt.getTime()) / 1000);
    }
    if (to === "RESOLVED") {
      setValues.resolvedAt = now;
      setValues.timeToResolveSeconds = Math.round((now.getTime() - current.createdAt.getTime()) / 1000);
    }

    const [row] = await tx.update(escalations).set(setValues).where(eq(escalations.id, escalationId)).returning();
    await tx.insert(escalationStateTransitions).values({
      escalationId,
      hospitalId: ctx.hospitalId,
      fromState: from,
      toState: to,
      reason,
      actor,
    });
    if (!extra.skipAudit) {
      await writeAuditLog(ctx, {
        action: `escalation.${to.toLowerCase()}`,
        resourceType: "escalation",
        resourceId: escalationId,
        reason,
        metadata: { before: { state: from }, after: { state: to, ...extra } },
      });
    }
    return row;
  });
}

/**
 * Doc 16 R5's "if not acknowledged" check. Idempotent no-op if the
 * escalation already moved on (already acknowledged, assigned, resolved,
 * closed, or overdue) — what makes this safe to call from a
 * duplicate-delivered event (R3).
 */
export async function acknowledgeEscalation(ctx: TenantContext, escalationId: string) {
  const [current] = await withTenant(ctx, (tx) => tx.select().from(escalations).where(eq(escalations.id, escalationId)));
  if (!current || TERMINAL_OR_ACKNOWLEDGED_STATES.includes(current.state) || !isValidEscalationTransition(current.state as EscalationState, "ACKNOWLEDGED")) {
    return null;
  }
  return transitionEscalationState(ctx, escalationId, "ACKNOWLEDGED", "acknowledged", `system:${ctx.userId}`, { skipAudit: true });
}

/** Doc 16 R5 — reached only if the backup-reviewer wait also timed out with no acknowledgment. Never overwrites a state that already moved on (out-of-order safety, R3). */
export async function markEscalationOverdue(ctx: TenantContext, escalationId: string) {
  const [current] = await withTenant(ctx, (tx) => tx.select().from(escalations).where(eq(escalations.id, escalationId)));
  if (!current || TERMINAL_OR_ACKNOWLEDGED_STATES.includes(current.state)) return null;
  return transitionEscalationState(ctx, escalationId, "OVERDUE", "reviewer_timeout exhausted (primary and backup)", `system:${ctx.userId}`, {
    skipAudit: true,
  });
}

/** Doc 17 R3 action bar — assign or reassign (same operation; reassigning an already-ASSIGNED escalation just changes assigned_to without a state change, handled separately below since ASSIGNED->ASSIGNED isn't a "transition"). */
export async function assignEscalation(ctx: TenantContext, escalationId: string, reviewerUserId: string, actor: string) {
  const [current] = await withTenant(ctx, (tx) => tx.select().from(escalations).where(eq(escalations.id, escalationId)));
  if (!current) return null;
  if (current.state === "ASSIGNED" || current.state === "IN_REVIEW" || current.state === "WAITING_FOR_INFORMATION") {
    // Reassignment — same state, only the assignee changes. Still audited.
    return withTenant(ctx, async (tx) => {
      const [row] = await tx.update(escalations).set({ assignedTo: reviewerUserId }).where(eq(escalations.id, escalationId)).returning();
      await writeAuditLog(ctx, {
        action: "escalation.reassigned",
        resourceType: "escalation",
        resourceId: escalationId,
        metadata: { before: { assignedTo: current.assignedTo }, after: { assignedTo: reviewerUserId } },
      });
      return row;
    });
  }
  return transitionEscalationState(ctx, escalationId, "ASSIGNED", "assigned to reviewer", actor, { assignedTo: reviewerUserId });
}

export async function requestMoreInformation(ctx: TenantContext, escalationId: string, reason: string, actor: string) {
  return transitionEscalationState(ctx, escalationId, "WAITING_FOR_INFORMATION", reason, actor);
}

export async function moveToInReview(ctx: TenantContext, escalationId: string, actor: string) {
  return transitionEscalationState(ctx, escalationId, "IN_REVIEW", "reviewer opened the case", actor);
}

export interface ResolveEscalationInput {
  outcome: EscalationResolutionOutcome;
  notes: string; // R4 — mandatory
}

/** Doc 17 R4 — structured outcome plus mandatory notes. Role enforcement (only CLINICAL_REVIEWER) is the caller's job via lib/auth/guard.ts's escalation:resolve action, not this function's. */
export async function resolveEscalation(ctx: TenantContext, escalationId: string, input: ResolveEscalationInput, actor: string) {
  return transitionEscalationState(ctx, escalationId, "RESOLVED", `resolved: ${input.outcome}`, actor, {
    resolution: input.notes,
    resolutionOutcome: input.outcome,
  });
}

export async function closeEscalation(ctx: TenantContext, escalationId: string, actor: string) {
  return transitionEscalationState(ctx, escalationId, "CLOSED", "closed", actor);
}

export interface EscalationQueueFilters {
  campaignId?: string;
  status?: EscalationState;
}

/**
 * Doc 17 R5 — the reviewer work queue: OVERDUE pinned to the top regardless
 * of priority, then priority descending, then age ascending (oldest first —
 * the longer something has waited at the same priority, the more urgent).
 * Closed/resolved escalations are excluded by default (an active queue, not
 * a full history) unless a status filter explicitly asks for them.
 */
export async function listEscalationsForQueue(ctx: TenantContext, filters: EscalationQueueFilters = {}) {
  return withTenant(ctx, async (tx) => {
    const conditions = [eq(escalations.hospitalId, ctx.hospitalId)];
    if (filters.campaignId) conditions.push(eq(escalations.campaignId, filters.campaignId));
    if (filters.status) {
      conditions.push(eq(escalations.state, filters.status));
    } else {
      conditions.push(ne(escalations.state, "RESOLVED"));
    }
    if (!filters.status) conditions.push(ne(escalations.state, "CLOSED"));

    const rows = await tx
      .select()
      .from(escalations)
      .where(and(...conditions))
      .orderBy(asc(escalations.createdAt));

    return rows.sort((a, b) => {
      const aOverdue = a.state === "OVERDUE" ? 1 : 0;
      const bOverdue = b.state === "OVERDUE" ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  });
}
