import { and, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { eligibilityEvaluations } from "../schema";
import type { RuleResult } from "../../campaigns/eligibility";

export interface UpsertEvaluationInput {
  campaignId: string;
  patientId: string;
  status: "ELIGIBLE" | "INELIGIBLE" | "ERROR";
  ruleResults?: RuleResult[];
  errorMessage?: string;
}

/** R4 — resume recomputes rather than replaying, so this always overwrites the prior evaluation for (campaign, patient) instead of appending. */
export async function upsertEvaluation(ctx: TenantContext, input: UpsertEvaluationInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(eligibilityEvaluations)
      .values({ ...input, hospitalId: ctx.hospitalId, evaluatedAt: new Date() })
      .onConflictDoUpdate({
        target: [eligibilityEvaluations.campaignId, eligibilityEvaluations.patientId],
        set: {
          status: input.status,
          ruleResults: input.ruleResults,
          errorMessage: input.errorMessage,
          evaluatedAt: new Date(),
        },
      })
      .returning();
    return row;
  });
}

export async function getEvaluation(ctx: TenantContext, campaignId: string, patientId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(eligibilityEvaluations)
      .where(and(eq(eligibilityEvaluations.campaignId, campaignId), eq(eligibilityEvaluations.patientId, patientId)));
    return row ?? null;
  });
}

export async function listEvaluationsForCampaign(ctx: TenantContext, campaignId: string, status?: "ELIGIBLE" | "INELIGIBLE" | "ERROR") {
  return withTenant(ctx, async (tx) => {
    const condition = status
      ? and(eq(eligibilityEvaluations.campaignId, campaignId), eq(eligibilityEvaluations.status, status))
      : eq(eligibilityEvaluations.campaignId, campaignId);
    return tx.select().from(eligibilityEvaluations).where(condition);
  });
}

/** Doc 05 R6 — the recovery list: every patient whose evaluation threw, never silently dropped. */
export async function listEligibilityErrors(ctx: TenantContext, campaignId: string) {
  return listEvaluationsForCampaign(ctx, campaignId, "ERROR");
}
