// Doc 06 §1 — the priority score. Pure function, no DB access, so it's
// unit-testable against the spec's own worked example.
//
// priority_score = 0.40*deadline_pressure + 0.30*clinical_risk
//                + 0.15*campaign_weight  + 0.10*wait_age
//                - 0.05*attempt_penalty
//
// Why these weights: deadline pressure dominates because a missed clinical
// window is an unrecoverable failure, while a delayed call is recoverable.
// Clinical risk is second because a high-risk patient's call carries more
// expected value. Campaign weight is an operator lever, deliberately
// weaker than clinical factors so business priority can never outrank
// patient safety. Wait-age guarantees monotonic progress toward selection
// so nothing starves. Attempt penalty is subtractive and small — it should
// nudge ordering, never exclude a patient outright.

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const RISK_VALUES: Record<RiskLevel, number> = {
  LOW: 0.1,
  MEDIUM: 0.4,
  HIGH: 0.7,
  CRITICAL: 1.0,
};

export interface ScoreInput {
  /** hours remaining until the clinical follow-up deadline */
  timeRemainingHours: number;
  /** the encounter's total follow-up window, in hours */
  totalWindowHours: number;
  riskLevel: RiskLevel;
  /** this campaign's priority_weight normalised across the hospital's running campaigns, already 0-1 */
  campaignWeight: number;
  hoursSinceEligible: number;
  attempts: number;
  maxAttempts: number;
}

export interface ScoreBreakdown {
  deadlinePressure: number;
  clinicalRisk: number;
  campaignWeight: number;
  waitAge: number;
  attemptPenalty: number;
  score: number;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function computeScore(input: ScoreInput): ScoreBreakdown {
  const deadlinePressure = clamp(1 - input.timeRemainingHours / input.totalWindowHours, 0, 1);
  const clinicalRisk = RISK_VALUES[input.riskLevel];
  const campaignWeight = clamp(input.campaignWeight, 0, 1);
  const waitAge = clamp(input.hoursSinceEligible / 24, 0, 1);
  const attemptPenalty = clamp(input.attempts / Math.max(1, input.maxAttempts), 0, 1);

  const score =
    0.4 * deadlinePressure + 0.3 * clinicalRisk + 0.15 * campaignWeight + 0.1 * waitAge - 0.05 * attemptPenalty;

  return { deadlinePressure, clinicalRisk, campaignWeight, waitAge, attemptPenalty, score };
}
