// Doc 05 decides who's ELIGIBLE; nothing before doc 06 turns that into an
// outreach_tasks row for the scheduler to claim. This is that bridge —
// called from lib/campaigns/transition.ts right after eligibility
// recompute, whenever a campaign moves to RUNNING.

import type { TenantContext } from "../db/tenant";
import { listEvaluationsForCampaign } from "../db/repositories/eligibility";
import { getPatientById } from "../db/repositories/patients";
import { listEncountersForPatient } from "../db/repositories/encounters";
import { hasTaskForPatientInCampaign, createOutreachTask } from "../db/repositories/outreach-tasks";
import type { campaigns } from "../db/schema";

type Campaign = typeof campaigns.$inferSelect;

/** Creates an outreach_task for every ELIGIBLE patient in this campaign that doesn't already have one — idempotent, safe to call on every RUNNING transition (including resume). */
export async function materializeEligibleTasks(ctx: TenantContext, campaign: Campaign): Promise<number> {
  const eligible = await listEvaluationsForCampaign(ctx, campaign.id, "ELIGIBLE");
  let created = 0;

  for (const evaluation of eligible) {
    if (await hasTaskForPatientInCampaign(ctx, campaign.id, evaluation.patientId)) continue;

    const patient = await getPatientById(ctx, evaluation.patientId);
    if (!patient) continue;

    const encounters = await listEncountersForPatient(ctx, evaluation.patientId);
    const mostRecent = encounters
      .filter((e) => e.dischargeAt)
      .sort((a, b) => (b.dischargeAt as Date).getTime() - (a.dischargeAt as Date).getTime())[0];
    if (!mostRecent) continue;

    const windowHours = mostRecent.followUpWindowHours ?? campaign.followUpWindowHours ?? 72;
    const clinicalDeadlineAt = new Date((mostRecent.dischargeAt as Date).getTime() + windowHours * 60 * 60 * 1000);

    await createOutreachTask(ctx, {
      campaignId: campaign.id,
      patientId: evaluation.patientId,
      encounterId: mostRecent.id,
      clinicalDeadlineAt,
      scheduledFor: new Date(), // immediately claimable; doc 07 refines calling-hours-aware scheduling
      maxAttempts: campaign.maxRetries + 1,
      riskLevel: mostRecent.riskLevel,
      totalWindowHours: windowHours,
    });
    created++;
  }

  return created;
}
