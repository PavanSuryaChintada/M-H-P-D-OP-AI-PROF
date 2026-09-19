// Doc 20 R3 — circuit breaker per external dependency. 5 consecutive
// failures opens the breaker for 60s; the next call after that is a
// half-open probe (one attempt allowed through) — success closes it,
// failure re-opens it for another 60s. In-memory per process, since this
// build has no shared external state store for breaker status and a
// single Next.js server process is the whole runtime here.

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 60_000;

type BreakerState = "closed" | "open" | "half_open";

interface Breaker {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
}

const breakers = new Map<string, Breaker>();

function getBreaker(dependency: string): Breaker {
  let breaker = breakers.get(dependency);
  if (!breaker) {
    breaker = { state: "closed", consecutiveFailures: 0, openedAt: null };
    breakers.set(dependency, breaker);
  }
  return breaker;
}

export class CircuitOpenError extends Error {
  constructor(dependency: string) {
    super(`circuit breaker open for "${dependency}"`);
    this.name = "CircuitOpenError";
  }
}

/** Call before attempting the dependency. Throws CircuitOpenError if the breaker is open and the cooldown hasn't elapsed — the caller must never proceed as if nothing were wrong. */
export function checkBreaker(dependency: string): void {
  const breaker = getBreaker(dependency);
  if (breaker.state === "open") {
    if (breaker.openedAt !== null && Date.now() - breaker.openedAt >= OPEN_DURATION_MS) {
      breaker.state = "half_open";
      return; // this one call is the probe
    }
    throw new CircuitOpenError(dependency);
  }
}

export function recordSuccess(dependency: string): void {
  const breaker = getBreaker(dependency);
  breaker.state = "closed";
  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
}

export function recordFailure(dependency: string): void {
  const breaker = getBreaker(dependency);
  if (breaker.state === "half_open") {
    // The probe failed — straight back to open, don't wait for 5 more failures.
    breaker.state = "open";
    breaker.openedAt = Date.now();
    return;
  }
  breaker.consecutiveFailures++;
  if (breaker.consecutiveFailures >= FAILURE_THRESHOLD) {
    breaker.state = "open";
    breaker.openedAt = Date.now();
  }
}

export function getBreakerState(dependency: string): BreakerState {
  return getBreaker(dependency).state;
}

/** Test-only — real callers should never need to force breaker state. */
export function resetBreaker(dependency: string): void {
  breakers.set(dependency, { state: "closed", consecutiveFailures: 0, openedAt: null });
}
