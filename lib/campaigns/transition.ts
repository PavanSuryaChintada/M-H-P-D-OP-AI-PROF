import { assertValidTransition, eventNameForTransition, type CampaignState } from "./lifecycle";
import { getCampaignById, persistTransition } from "../db/repositories/campaigns";
import { emitEvent } from "../db/repositories/events";
import { writeAuditLog } from "../db/repositories/audit";
import { evaluateCampaignEligibility } from "./evaluate";
import { materializeEligibleTasks } from "../queue/materialize";
import type { TenantContext } from "../db/tenant";

export async function transitionCampaign(
  ctx: TenantContext,
  campaignId: string,
  to: CampaignState,
  reason: string,
) {
  const campaign = await getCampaignById(ctx, campaignId);
  if (!campaign) throw new Error("campaign not found");

  const from = campaign.state as CampaignState;
  assertValidTransition(from, to);

  // R4 — resume recomputes eligibility rather than replaying the old task
  // list, and does it BEFORE flipping the state so a scheduler tick racing
  // this call never observes RUNNING with stale evaluations. Doc 06 bridges
  // the result into outreach_tasks — materialize is idempotent (skips
  // patients who already have a task for this campaign), which is exactly
  // what "recompute, don't replay" requires on a pause/resume cycle.
  if (to === "RUNNING") {
    await evaluateCampaignEligibility(ctx, campaign);
    await materializeEligibleTasks(ctx, campaign);
  }

  const updated = await persistTransition(ctx, campaignId, from, to, reason, `user:${ctx.userId}`);

  const eventName = eventNameForTransition(from, to);
  if (eventName) {
    await emitEvent(ctx, {
      type: eventName,
      payload: { campaignId, from, to },
      idempotencyKey: `${eventName}:${campaignId}:${Date.now()}`,
    });
  }

  await writeAuditLog(ctx, {
    action: `campaign.transition.${to.toLowerCase()}`,
    resourceType: "campaign",
    resourceId: campaignId,
    metadata: { from, to, reason },
  });

  return updated;
}
