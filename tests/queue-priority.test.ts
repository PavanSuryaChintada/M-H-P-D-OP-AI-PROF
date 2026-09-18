// Doc 06 §1 — the exact worked example from the spec must reproduce.

import { describe, expect, it } from "vitest";
import { computeScore } from "../lib/queue/priority";
import { assignTier } from "../lib/queue/tier";

describe("computeScore — worked example", () => {
  it("patient A: critical, 20h/24h remaining, 0 attempts -> ~0.50", () => {
    const result = computeScore({
      timeRemainingHours: 20,
      totalWindowHours: 24,
      riskLevel: "CRITICAL",
      campaignWeight: 0.8,
      hoursSinceEligible: 0.1 * 24, // wait_age input is hours; waitAge output = hoursSinceEligible/24 = 0.1
      attempts: 0,
      maxAttempts: 3,
    });
    expect(result.score).toBeCloseTo(0.4967, 3);
  });

  it("patient C: high, 6h/24h remaining, 0 attempts -> 0.67", () => {
    const result = computeScore({
      timeRemainingHours: 6,
      totalWindowHours: 24,
      riskLevel: "HIGH",
      campaignWeight: 0.8,
      hoursSinceEligible: 0.4 * 24,
      attempts: 0,
      maxAttempts: 3,
    });
    expect(result.score).toBeCloseTo(0.67, 3);
  });

  it("clamps deadline_pressure at 0 for a task with more time remaining than its total window (shouldn't happen, but must not go negative)", () => {
    const result = computeScore({
      timeRemainingHours: 30,
      totalWindowHours: 24,
      riskLevel: "LOW",
      campaignWeight: 0,
      hoursSinceEligible: 0,
      attempts: 0,
      maxAttempts: 3,
    });
    expect(result.deadlinePressure).toBe(0);
  });

  it("attempt_penalty is subtractive and small — never exceeds 0.05 of the total score", () => {
    const maxed = computeScore({
      timeRemainingHours: 100,
      totalWindowHours: 100,
      riskLevel: "LOW",
      campaignWeight: 0,
      hoursSinceEligible: 0,
      attempts: 10,
      maxAttempts: 3,
    });
    const zero = computeScore({
      timeRemainingHours: 100,
      totalWindowHours: 100,
      riskLevel: "LOW",
      campaignWeight: 0,
      hoursSinceEligible: 0,
      attempts: 0,
      maxAttempts: 3,
    });
    expect(zero.score - maxed.score).toBeCloseTo(0.05, 5);
  });
});

describe("assignTier — worked example", () => {
  const now = new Date("2026-09-18T12:00:00Z");

  it("patient B: callback not due, but under 2h absolute remaining -> Tier 1", () => {
    const tier = assignTier({ callbackRequestedAt: null, now, timeRemainingHours: 1.5, totalWindowHours: 48 });
    expect(tier).toBe(1);
  });

  it("a due callback (within 10 min) is Tier 0 regardless of window", () => {
    const tier = assignTier({
      callbackRequestedAt: new Date(now.getTime() + 5 * 60_000),
      now,
      timeRemainingHours: 40,
      totalWindowHours: 48,
    });
    expect(tier).toBe(0);
  });

  it("a callback more than 10 minutes away is not yet Tier 0", () => {
    const tier = assignTier({
      callbackRequestedAt: new Date(now.getTime() + 30 * 60_000),
      now,
      timeRemainingHours: 40,
      totalWindowHours: 48,
    });
    expect(tier).not.toBe(0);
  });

  it("remaining ratio under 20% is Tier 1 even with more than 2h absolute left", () => {
    const tier = assignTier({ callbackRequestedAt: null, now, timeRemainingHours: 4, totalWindowHours: 24 });
    expect(tier).toBe(1); // 4/24 = 0.167 < 0.20
  });

  it("plenty of time and ratio is Tier 2", () => {
    const tier = assignTier({ callbackRequestedAt: null, now, timeRemainingHours: 20, totalWindowHours: 24 });
    expect(tier).toBe(2); // 20/24 = 0.83, and 20h > 2h absolute
  });

  it("full worked example ordering: B (tier1) before C (0.67) before A (0.4967)", () => {
    const tierA = assignTier({ callbackRequestedAt: null, now, timeRemainingHours: 20, totalWindowHours: 24 });
    const tierB = assignTier({ callbackRequestedAt: null, now, timeRemainingHours: 1.5, totalWindowHours: 48 });
    const tierC = assignTier({ callbackRequestedAt: null, now, timeRemainingHours: 6, totalWindowHours: 24 });
    expect(tierB).toBe(1);
    expect(tierA).toBe(2);
    expect(tierC).toBe(2);

    const scoreA = computeScore({ timeRemainingHours: 20, totalWindowHours: 24, riskLevel: "CRITICAL", campaignWeight: 0.8, hoursSinceEligible: 2.4, attempts: 0, maxAttempts: 3 }).score;
    const scoreC = computeScore({ timeRemainingHours: 6, totalWindowHours: 24, riskLevel: "HIGH", campaignWeight: 0.8, hoursSinceEligible: 9.6, attempts: 0, maxAttempts: 3 }).score;

    // Selection order: tier ascending, then score descending within a tier.
    // B is tier 1, A and C are tier 2 with C scoring higher than A — so the
    // full order is B, C, A, exactly as the spec states.
    expect(scoreC).toBeGreaterThan(scoreA);
  });
});
