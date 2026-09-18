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

export function assignTier(input: TierInput): Tier {
  if (input.callbackRequestedAt) {
    const diffMinutes = Math.abs(input.now.getTime() - input.callbackRequestedAt.getTime()) / 60_000;
    if (diffMinutes <= CALLBACK_WINDOW_MINUTES) return 0;
  }

  const remainingRatio = input.totalWindowHours > 0 ? input.timeRemainingHours / input.totalWindowHours : 0;
  if (remainingRatio < CUTOFF_RATIO || input.timeRemainingHours < CUTOFF_ABSOLUTE_HOURS) return 1;

  return 2;
}
