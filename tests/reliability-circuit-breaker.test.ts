// Doc 20 R3 — 5 consecutive failures opens the breaker; it fails fast
// (never calls the provider) until the 60s cooldown elapses, then allows
// one half-open probe. An open breaker must surface as the same
// PROVIDER_ERROR shape a real outage would, so doc 12/13's existing
// repair-loop and reduced-assessor escalation handle it with zero changes.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { checkBreaker, recordSuccess, recordFailure, getBreakerState, resetBreaker, CircuitOpenError } from "../lib/reliability/circuit-breaker";
import { runStructured } from "../lib/ai/providers/managed-call";
import { z } from "zod";
import type { AIProvider } from "../lib/ai/providers/types";
import type { TenantContext } from "../lib/db/tenant";

const DEP = "test-provider";

describe("circuit breaker (doc 20 R3)", () => {
  beforeEach(() => resetBreaker(DEP));

  it("stays closed under fewer than 5 consecutive failures", () => {
    for (let i = 0; i < 4; i++) recordFailure(DEP);
    expect(getBreakerState(DEP)).toBe("closed");
    expect(() => checkBreaker(DEP)).not.toThrow();
  });

  it("opens after 5 consecutive failures and fails fast", () => {
    for (let i = 0; i < 5; i++) recordFailure(DEP);
    expect(getBreakerState(DEP)).toBe("open");
    expect(() => checkBreaker(DEP)).toThrow(CircuitOpenError);
  });

  it("a success resets the failure count", () => {
    for (let i = 0; i < 4; i++) recordFailure(DEP);
    recordSuccess(DEP);
    for (let i = 0; i < 4; i++) recordFailure(DEP);
    expect(getBreakerState(DEP)).toBe("closed"); // 4 + 4 would trip it if the count didn't reset
  });

  it("allows a half-open probe after the cooldown, and a failed probe re-opens immediately", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) recordFailure(DEP);
      expect(getBreakerState(DEP)).toBe("open");

      vi.advanceTimersByTime(60_001);
      expect(() => checkBreaker(DEP)).not.toThrow(); // the probe is allowed through
      expect(getBreakerState(DEP)).toBe("half_open");

      recordFailure(DEP); // probe failed
      expect(getBreakerState(DEP)).toBe("open");
      expect(() => checkBreaker(DEP)).toThrow(CircuitOpenError); // no second freebie
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("an open breaker fails fast without calling the provider (doc 20 R3)", () => {
  const ctx: TenantContext = { hospitalId: "00000000-0000-0000-0000-000000000000", userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" };

  it("runStructured never invokes the provider once its breaker is open", async () => {
    resetBreaker("breaker-fail-fast-test");
    for (let i = 0; i < 5; i++) recordFailure("breaker-fail-fast-test");

    const generateStructured = vi.fn();
    const provider: AIProvider = { id: "breaker-fail-fast-test", generate: vi.fn(), generateStructured };

    const result = await runStructured(provider, "mock-model", { system: "s", prompt: "p", schema: z.object({}) }, { ctx, agent: "test" });

    expect(result.ok).toBe(false);
    expect(generateStructured).not.toHaveBeenCalled();
    resetBreaker("breaker-fail-fast-test");
  });
});
