// Doc 15 R3 — realistic failure injection, pure and RNG-injectable so tests
// can force deterministic outcomes (error rate 0 or 1) without patching
// Math.random.

export type InjectedOutcome = "ok" | "error" | "rate_limited" | "timeout";

export interface FailureInjectionResult {
  latencyMs: number;
  outcome: InjectedOutcome;
}

/**
 * failureRate is hospital_config.ehr_settings.failure_rate (0-1). On a
 * failure draw, the failure is split across the three failure shapes R3
 * asks for: mostly plain 500s, occasionally a 429, rarely a timeout.
 */
export function injectFailure(failureRate: number, rng: () => number = Math.random): FailureInjectionResult {
  const latencyMs = 100 + Math.floor(rng() * 700); // 100-800ms
  if (rng() >= failureRate) return { latencyMs, outcome: "ok" };

  const r = rng();
  if (r < 0.7) return { latencyMs, outcome: "error" };
  if (r < 0.85) return { latencyMs, outcome: "rate_limited" };
  return { latencyMs: latencyMs + 2000, outcome: "timeout" };
}
