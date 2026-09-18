// Doc 07 §2 — the literal outcome table, checked as data.

import { describe, expect, it } from "vitest";
import { OUTCOME_POLICY } from "../lib/queue/outcome-policy";

describe("OUTCOME_POLICY", () => {
  it("PROVIDER_ERROR retries but does not consume an attempt — the spec's called-out design point", () => {
    expect(OUTCOME_POLICY.PROVIDER_ERROR.retry).toBe(true);
    expect(OUTCOME_POLICY.PROVIDER_ERROR.consumesAttempt).toBe(false);
  });

  it("NETWORK_FAILURE retries and does consume an attempt (unlike PROVIDER_ERROR)", () => {
    expect(OUTCOME_POLICY.NETWORK_FAILURE.retry).toBe(true);
    expect(OUTCOME_POLICY.NETWORK_FAILURE.consumesAttempt).toBe(true);
  });

  it("INVALID_NUMBER and DECLINED never retry", () => {
    expect(OUTCOME_POLICY.INVALID_NUMBER.retry).toBe(false);
    expect(OUTCOME_POLICY.DECLINED.retry).toBe(false);
  });

  it("BUSY uses the short 10-minute backoff, not the standard table", () => {
    expect(OUTCOME_POLICY.BUSY.backoffMinutes).toBe(10);
  });

  it("DROPPED uses 5-minute backoff and preserves context", () => {
    expect(OUTCOME_POLICY.DROPPED.backoffMinutes).toBe(5);
    expect(OUTCOME_POLICY.DROPPED.preservesContext).toBe(true);
  });

  it("VOICEMAIL caps at 2 retries regardless of the campaign's general retry budget", () => {
    expect(OUTCOME_POLICY.VOICEMAIL.maxRetriesOverride).toBe(2);
  });

  it("CALLBACK_REQUESTED is pinned, not scored, and doesn't consume an attempt", () => {
    expect(OUTCOME_POLICY.CALLBACK_REQUESTED.retry).toBe("pinned");
    expect(OUTCOME_POLICY.CALLBACK_REQUESTED.consumesAttempt).toBe(false);
  });
});
