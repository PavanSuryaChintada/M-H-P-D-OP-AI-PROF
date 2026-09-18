import { and, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { outreachTasks, campaigns } from "../schema";

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
