// Doc 06 §1 — tiered first, scored second. Some conditions dominate any
// score: a callback due right now, or a window about to close, must win
// regardless of what the Tier 2 formula would say.

export type Tier = 0 | 1 | 2;

export interface TierInput {
  callbackRequestedAt: Date | null;
  now: Date;
  /** hours remaining until the clinical follow-up deadline */
  timeRemainingHours: number;
  totalWindowHours: number;
}

const CALLBACK_WINDOW_MINUTES = 10;
const CUTOFF_RATIO = 0.2;
const CUTOFF_ABSOLUTE_HOURS = 2;

/**
 * Doc 08's simulation compresses a 24h-equivalent run into a few minutes of
 * real wall-clock time (see sim/queue-sim.ts) without a full virtual-clock
 * refactor of the SQL layer — instead these absolute thresholds scale down
 * together with the compressed dataset, so "2 hours absolute" stays a
 * meaningful fraction of a much shorter window rather than swallowing it
 * whole. Production code never passes this; defaults are unchanged.
 */
export interface TierThresholds {
  callbackWindowMinutes?: number;
  cutoffRatio?: number;
  cutoffAbsoluteHours?: number;
}

export function assignTier(input: TierInput, thresholds: TierThresholds = {}): Tier {
  const callbackWindowMinutes = thresholds.callbackWindowMinutes ?? CALLBACK_WINDOW_MINUTES;
  const cutoffRatio = thresholds.cutoffRatio ?? CUTOFF_RATIO;
  const cutoffAbsoluteHours = thresholds.cutoffAbsoluteHours ?? CUTOFF_ABSOLUTE_HOURS;

  if (input.callbackRequestedAt) {
    const diffMinutes = Math.abs(input.now.getTime() - input.callbackRequestedAt.getTime()) / 60_000;
    if (diffMinutes <= callbackWindowMinutes) return 0;
  }

  const remainingRatio = input.totalWindowHours > 0 ? input.timeRemainingHours / input.totalWindowHours : 0;
  if (remainingRatio < cutoffRatio || input.timeRemainingHours < cutoffAbsoluteHours) return 1;

  return 2;
}
