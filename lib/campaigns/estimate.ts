// Doc 05 R3 — pre-activation workload estimate. A heuristic by nature
// (the PRD's own word is "projected") — the blended expected-attempts and
// fixed average-call-length assumptions are documented here, not hidden.

export interface EstimateInput {
  eligibleCount: number;
  /** initial attempt + retries, e.g. campaign.maxRetries + 1 */
  maxAttempts: number;
  maxConcurrentCalls: number;
  /** hours until the earliest closing follow-up deadline among eligible patients */
  hoursRemainingInWindow: number;
  avgCallMinutes?: number;
}

export interface EstimateResult {
  eligibleCount: number;
  projectedAttempts: number;
  projectedCallMinutes: number;
  availableCapacityMinutes: number;
  feasible: boolean;
}

const DEFAULT_AVG_CALL_MINUTES = 5;

export function computeEstimate(input: EstimateInput): EstimateResult {
  const avgCallMinutes = input.avgCallMinutes ?? DEFAULT_AVG_CALL_MINUTES;
  // Not every patient needs the max number of attempts — blend across
  // 1..maxAttempts rather than assuming worst case for all of them.
  const expectedAttemptsPerPatient = (1 + input.maxAttempts) / 2;
  const projectedAttempts = Math.ceil(input.eligibleCount * expectedAttemptsPerPatient);
  const projectedCallMinutes = projectedAttempts * avgCallMinutes;
  const availableCapacityMinutes = Math.max(0, input.maxConcurrentCalls * input.hoursRemainingInWindow * 60);

  return {
    eligibleCount: input.eligibleCount,
    projectedAttempts,
    projectedCallMinutes,
    availableCapacityMinutes,
    feasible: projectedCallMinutes <= availableCapacityMinutes,
  };
}
