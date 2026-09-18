import { desc, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { calls } from "../schema";
import type { CallOutcome } from "../../queue/outcome-policy";

export interface CreateCallInput {
  outreachTaskId: string;
  campaignId: string;
  patientId: string;
  attemptNumber: number;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  outcome?: CallOutcome;
  partialState?: unknown;
}

/** UNIQUE (outreach_task_id, attempt_number) — doc 07 §7 duplicate prevention. A retried write for the same attempt is a conflict, not a new row. */
export async function createCall(ctx: TenantContext, input: CreateCallInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(calls)
      .values({ ...input, hospitalId: ctx.hospitalId })
      .onConflictDoNothing({ target: [calls.outreachTaskId, calls.attemptNumber] })
      .returning();
    return row ?? null;
  });
}

/** Doc 07 §5 — the most recent call for this task, to read partial_state back for a resumption after DROPPED. */
export async function getMostRecentCallForTask(ctx: TenantContext, outreachTaskId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(calls)
      .where(eq(calls.outreachTaskId, outreachTaskId))
      .orderBy(desc(calls.attemptNumber))
      .limit(1);
    return row ?? null;
  });
}
