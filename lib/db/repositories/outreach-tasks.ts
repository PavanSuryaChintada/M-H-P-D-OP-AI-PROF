import { and, eq, sql } from "drizzle-orm";
import { withTenant, withHospitalContext, type TenantContext } from "../tenant";
import { outreachTasks, campaigns, hospitalCapacity, outreachTaskStateTransitions } from "../schema";
import type { TaskState } from "../../queue/state-machine";

// Minimal — doc 05's eligibility engine needs to know a patient's existing
// tasks across campaigns (the "not already completed" / "not in a
// conflicting campaign" rules). Full task lifecycle (claiming, retries,
// callbacks) is doc 06/07's scope.
export async function listOutreachTasksForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) => tx.select().from(outreachTasks).where(eq(outreachTasks.patientId, patientId)));
}

export async function getTaskById(ctx: TenantContext, taskId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(outreachTasks).where(eq(outreachTasks.id, taskId));
    return row ?? null;
  });
}

/** Doc 06 materialize.ts — idempotency check before creating a task for a newly-ELIGIBLE patient. */
export async function hasTaskForPatientInCampaign(ctx: TenantContext, campaignId: string, patientId: string): Promise<boolean> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({ id: outreachTasks.id })
      .from(outreachTasks)
      .where(and(eq(outreachTasks.campaignId, campaignId), eq(outreachTasks.patientId, patientId)));
    return rows.length > 0;
  });
}

export interface CreateOutreachTaskInput {
  campaignId: string;
  patientId: string;
  encounterId: string;
  clinicalDeadlineAt: Date;
  scheduledFor: Date;
  maxAttempts: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  totalWindowHours: number;
}

export async function createOutreachTask(ctx: TenantContext, input: CreateOutreachTaskInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(outreachTasks)
      .values({ ...input, hospitalId: ctx.hospitalId, state: "PENDING" })
      .returning();
    return row;
  });
}

export interface TaskTransitionExtra {
  scheduledFor?: Date | null;
  callbackRequestedAt?: Date | null;
  lastError?: string | null;
  attemptCountDelta?: number;
}

/** Doc 07 §1 — persists a state move + its history row. Does not validate the move itself (lib/queue/state-machine.ts does that before calling this) and does not touch capacity — use the *AndReleaseCapacity variant for the hop out of CALLING/CONNECTED. */
export async function transitionTaskState(
  ctx: TenantContext,
  taskId: string,
  from: TaskState,
  to: TaskState,
  reason: string,
  actor: string,
  extra: TaskTransitionExtra = {},
) {
  return withTenant(ctx, async (tx) => {
    const setValues: Record<string, unknown> = { state: to, updatedAt: new Date() };
    if (extra.scheduledFor !== undefined) setValues.scheduledFor = extra.scheduledFor;
    if (extra.callbackRequestedAt !== undefined) setValues.callbackRequestedAt = extra.callbackRequestedAt;
    if (extra.lastError !== undefined) setValues.lastError = extra.lastError;
    if (extra.attemptCountDelta) setValues.attemptCount = sql`${outreachTasks.attemptCount} + ${extra.attemptCountDelta}`;

    const [task] = await tx.update(outreachTasks).set(setValues).where(eq(outreachTasks.id, taskId)).returning();
    await tx.insert(outreachTaskStateTransitions).values({
      outreachTaskId: taskId,
      hospitalId: ctx.hospitalId,
      fromState: from,
      toState: to,
      reason,
      actor,
    });
    return task;
  });
}

/** Doc 07 §2 "Release" — decrements hospital_capacity in the SAME transaction as the state write, never as a separate step. Use this specifically for the hop a task takes out of CALLING/CONNECTED (the only point a claimed slot is ever given back). */
export async function transitionTaskStateAndReleaseCapacity(
  ctx: TenantContext,
  taskId: string,
  from: TaskState,
  to: TaskState,
  reason: string,
  actor: string,
  extra: TaskTransitionExtra = {},
) {
  return withTenant(ctx, async (tx) => {
    const setValues: Record<string, unknown> = { state: to, updatedAt: new Date() };
    if (extra.scheduledFor !== undefined) setValues.scheduledFor = extra.scheduledFor;
    if (extra.callbackRequestedAt !== undefined) setValues.callbackRequestedAt = extra.callbackRequestedAt;
    if (extra.lastError !== undefined) setValues.lastError = extra.lastError;
    if (extra.attemptCountDelta) setValues.attemptCount = sql`${outreachTasks.attemptCount} + ${extra.attemptCountDelta}`;

    const [task] = await tx.update(outreachTasks).set(setValues).where(eq(outreachTasks.id, taskId)).returning();
    await tx.insert(outreachTaskStateTransitions).values({
      outreachTaskId: taskId,
      hospitalId: ctx.hospitalId,
      fromState: from,
      toState: to,
      reason,
      actor,
    });
    await tx
      .update(hospitalCapacity)
      .set({ currentActiveCalls: sql`greatest(0, ${hospitalCapacity.currentActiveCalls} - 1)`, updatedAt: new Date() })
      .where(eq(hospitalCapacity.hospitalId, ctx.hospitalId));
    return task;
  });
}

/** This task's campaign's priority weight, normalised across the hospital's currently-RUNNING campaigns — same definition recompute.ts uses in SQL, reimplemented in JS for the score-explainability endpoint (doc 06 deliverable). */
export async function getNormalizedCampaignWeight(ctx: TenantContext, campaignId: string): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const running = await tx
      .select({ id: campaigns.id, weight: campaigns.priority })
      .from(campaigns)
      .where(and(eq(campaigns.hospitalId, ctx.hospitalId), eq(campaigns.state, "RUNNING")));

    const totalWeight = running.reduce((sum, c) => sum + Math.max(c.weight, 0), 0) || 1;
    const thisCampaign = running.find((c) => c.id === campaignId);
    return thisCampaign ? Math.max(thisCampaign.weight, 0) / totalWeight : 0;
  });
}

/**
 * Doc 07 §6 — the reaper. Worker processes have no TenantContext, so this
 * uses withHospitalContext like the scheduler. Resets any CALLING/CONNECTED
 * task whose lease has expired back to RETRY_SCHEDULED, releases the
 * capacity slot it was holding, and does NOT touch attempt_count — a
 * crashed worker is never the patient's fault, and never permanently holds
 * capacity (PRD §11/§24).
 */
export async function reapExpiredLeases(hospitalId: string): Promise<string[]> {
  return withHospitalContext(hospitalId, async (tx) => {
    const stale = await tx
      .select({ id: outreachTasks.id, state: outreachTasks.state })
      .from(outreachTasks)
      .where(
        and(
          eq(outreachTasks.hospitalId, hospitalId),
          sql`${outreachTasks.state} in ('CALLING', 'CONNECTED')`,
          sql`${outreachTasks.leaseExpiresAt} < now()`,
        ),
      );

    if (stale.length === 0) return [];

    for (const task of stale) {
      await tx
        .update(outreachTasks)
        .set({
          state: "RETRY_SCHEDULED",
          claimedBy: null,
          leaseExpiresAt: null,
          scheduledFor: sql`now() + interval '2 minutes'`,
          lastError: "lease_expired",
          updatedAt: new Date(),
        })
        .where(eq(outreachTasks.id, task.id));

      await tx.insert(outreachTaskStateTransitions).values({
        outreachTaskId: task.id,
        hospitalId,
        fromState: task.state,
        toState: "RETRY_SCHEDULED",
        reason: "lease_expired",
        actor: "system:reaper",
      });
    }

    await tx
      .update(hospitalCapacity)
      .set({
        currentActiveCalls: sql`greatest(0, ${hospitalCapacity.currentActiveCalls} - ${stale.length})`,
        updatedAt: new Date(),
      })
      .where(eq(hospitalCapacity.hospitalId, hospitalId));

    return stale.map((t) => t.id);
  });
}
