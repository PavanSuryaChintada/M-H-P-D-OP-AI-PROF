// Doc 05 R3 — pre-activation estimate, pure, no database.

import { describe, expect, it } from "vitest";
import { computeEstimate } from "../lib/campaigns/estimate";

describe("computeEstimate", () => {
  it("flags infeasible when capacity clearly can't cover the projected load", () => {
    const result = computeEstimate({
      eligibleCount: 200,
      maxAttempts: 3,
      maxConcurrentCalls: 1,
      hoursRemainingInWindow: 2,
    });
    expect(result.feasible).toBe(false);
    expect(result.projectedAttempts).toBeGreaterThan(0);
  });

  it("flags feasible when capacity comfortably covers the projected load", () => {
    const result = computeEstimate({
      eligibleCount: 10,
      maxAttempts: 3,
      maxConcurrentCalls: 10,
      hoursRemainingInWindow: 24,
    });
    expect(result.feasible).toBe(true);
  });

  it("blends expected attempts across 1..maxAttempts rather than assuming worst case", () => {
    const result = computeEstimate({ eligibleCount: 100, maxAttempts: 3, maxConcurrentCalls: 100, hoursRemainingInWindow: 100 });
    // expected attempts per patient = (1+3)/2 = 2, so 100 patients -> 200 attempts
    expect(result.projectedAttempts).toBe(200);
  });

  it("zero eligible patients is trivially feasible", () => {
    const result = computeEstimate({ eligibleCount: 0, maxAttempts: 3, maxConcurrentCalls: 1, hoursRemainingInWindow: 0 });
    expect(result.feasible).toBe(true);
    expect(result.projectedAttempts).toBe(0);
  });
});
