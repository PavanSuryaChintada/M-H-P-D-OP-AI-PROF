// Doc 06 §Fairness / §2 — one scheduler tick: recompute scores, compute
// per-campaign ceilings, then claim in a loop until capacity is exhausted
// or nothing is claimable.

import { recomputeScores } from "./recompute";
import { claimNextTask, type ClaimedTask, DEFAULT_PATIENT_CALL_COOLDOWN_MINUTES } from "./claim";
import { listRunningCampaignWeightsByHospitalId } from "../db/repositories/campaigns";
import { getHospitalCapacityByHospitalId } from "../db/repositories/hospital-capacity";

/**
 * campaign_ceiling = max(1, floor(free_capacity * weight / sum_weights)).
 * Guarantees every running campaign gets at least one slot per tick, so a
 * high-weight campaign can never fully starve a low-weight one — combined
 * with wait_age, starvation is prevented by two independent mechanisms.
 */
function computeCeilings(campaignWeights: { id: string; weight: number }[], freeCapacity: number): Map<string, number> {
  const totalWeight = campaignWeights.reduce((sum, c) => sum + Math.max(c.weight, 0), 0) || 1;
  const ceilings = new Map<string, number>();
  for (const c of campaignWeights) {
    ceilings.set(c.id, Math.max(1, Math.floor((freeCapacity * Math.max(c.weight, 0)) / totalWeight)));
  }
  return ceilings;
}

export interface TickResult {
  claimed: ClaimedTask[];
  freeCapacityAtStart: number;
}

export async function runSchedulerTick(
  hospitalId: string,
  workerId: string,
  cooldownMinutes: number = DEFAULT_PATIENT_CALL_COOLDOWN_MINUTES,
): Promise<TickResult> {
  await recomputeScores(hospitalId);

  const runningCampaigns = await listRunningCampaignWeightsByHospitalId(hospitalId);
  if (runningCampaigns.length === 0) return { claimed: [], freeCapacityAtStart: 0 };

  const capacity = await getHospitalCapacityByHospitalId(hospitalId);
  if (!capacity) return { claimed: [], freeCapacityAtStart: 0 };

  const freeCapacityAtStart = Math.max(0, capacity.maxConcurrentCalls - capacity.currentActiveCalls);
  const remainingCeiling = computeCeilings(runningCampaigns, freeCapacityAtStart);

  const claimed: ClaimedTask[] = [];
  // Bounded by freeCapacityAtStart so a pathological loop (e.g. every
  // claim attempt racing another worker to exhaustion) can't spin forever.
  for (let i = 0; i < freeCapacityAtStart; i++) {
    const eligibleCampaignIds = [...remainingCeiling.entries()].filter(([, n]) => n > 0).map(([id]) => id);
    if (eligibleCampaignIds.length === 0) break;

    const task = await claimNextTask(hospitalId, workerId, eligibleCampaignIds, cooldownMinutes);
    if (!task) break; // nothing claimable among currently-eligible campaigns

    claimed.push(task);
    remainingCeiling.set(task.campaignId, (remainingCeiling.get(task.campaignId) ?? 1) - 1);
  }

  return { claimed, freeCapacityAtStart };
}
