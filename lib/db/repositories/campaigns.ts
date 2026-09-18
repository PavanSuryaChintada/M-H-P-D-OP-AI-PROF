import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { campaigns, campaignStateTransitions } from "../schema";
import type { CampaignState } from "../../campaigns/lifecycle";

export interface CreateCampaignInput {
  name: string;
  description?: string;
  eligibilityCriteria?: unknown;
  followUpWindowHours?: number;
  callingHoursStart?: string;
  callingHoursEnd?: string;
  priority?: number;
  maxRetries?: number;
  capacityShare?: number;
  protocolId?: string;
  startDate?: Date;
  endDate?: Date;
}

export async function createCampaign(ctx: TenantContext, input: CreateCampaignInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(campaigns).values({ ...input, hospitalId: ctx.hospitalId }).returning();
    return row;
  });
}

export async function getCampaignById(ctx: TenantContext, campaignId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
    return row ?? null;
  });
}

export async function listCampaigns(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => tx.select().from(campaigns).where(eq(campaigns.hospitalId, ctx.hospitalId)));
}

export async function updateCampaignConfig(ctx: TenantContext, campaignId: string, input: Partial<CreateCampaignInput>) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .update(campaigns)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId))
      .returning();
    return row ?? null;
  });
}

/** Doc 05 R1 — the only way campaign.state should ever change. Does not validate the transition itself (lib/campaigns/lifecycle.ts does that before calling this) — this just persists the move and its history row atomically. */
export async function persistTransition(
  ctx: TenantContext,
  campaignId: string,
  from: CampaignState,
  to: CampaignState,
  reason: string,
  actor: string,
) {
  return withTenant(ctx, async (tx) => {
    const [campaign] = await tx
      .update(campaigns)
      .set({ state: to, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId))
      .returning();
    await tx.insert(campaignStateTransitions).values({
      campaignId,
      hospitalId: ctx.hospitalId,
      fromState: from,
      toState: to,
      reason,
      actor,
    });
    return campaign;
  });
}

export async function listStateTransitions(ctx: TenantContext, campaignId: string) {
  return withTenant(ctx, async (tx) =>
    tx.select().from(campaignStateTransitions).where(eq(campaignStateTransitions.campaignId, campaignId)),
  );
}
