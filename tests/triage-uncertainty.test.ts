// Doc 12 R5 — confidence is not decorative. A low-confidence "routine"
// classification is forced to "uncertain", not trusted as-is.

import { describe, expect, it } from "vitest";
import { applyUncertaintyForcing } from "../lib/ai/triage/uncertainty";
import type { TriageResult } from "../lib/ai/schemas/triage";

function result(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    schema_version: "1.0",
    assessor_id: "test",
    classification: "routine",
    confidence: 0.9,
    observations: [],
    indicators: [],
    missing_information: [],
    escalation_recommended: false,
    reasoning_summary: "test",
    ...overrides,
  };
}

describe("applyUncertaintyForcing", () => {
  it("forces routine with confidence < 0.6 to uncertain", () => {
    const outcome = applyUncertaintyForcing(result({ confidence: 0.5 }));
    expect(outcome.forced).toBe(true);
    expect(outcome.reason).toBe("LOW_CONFIDENCE");
    expect(outcome.result.classification).toBe("uncertain");
  });

  it("does not force routine with confidence >= 0.6", () => {
    const outcome = applyUncertaintyForcing(result({ confidence: 0.6 }));
    expect(outcome.forced).toBe(false);
    expect(outcome.result.classification).toBe("routine");
  });

  it("does not force a non-routine classification just for low confidence — R5 is specifically about routine", () => {
    const outcome = applyUncertaintyForcing(result({ classification: "concerning", confidence: 0.1 }));
    expect(outcome.forced).toBe(false);
  });

  it("forces uncertain when missing_information exceeds 30% of protocol questions", () => {
    const outcome = applyUncertaintyForcing(result({ missing_information: ["q1", "q2", "q3", "q4"] }), {
      totalProtocolQuestions: 10,
    });
    expect(outcome.forced).toBe(true);
    expect(outcome.reason).toBe("INSUFFICIENT_INFORMATION");
  });

  it("does not force uncertain when missing_information is exactly 30% or below", () => {
    const outcome = applyUncertaintyForcing(result({ missing_information: ["q1", "q2", "q3"] }), {
      totalProtocolQuestions: 10,
    });
    expect(outcome.forced).toBe(false);
  });

  it("forces uncertain when the call ended in DROPPED", () => {
    const outcome = applyUncertaintyForcing(result(), { callOutcome: "DROPPED" });
    expect(outcome.forced).toBe(true);
    expect(outcome.reason).toBe("CALL_DROPPED");
  });

  it("leaves a confident, complete, non-dropped routine result unchanged", () => {
    const outcome = applyUncertaintyForcing(result({ confidence: 0.95 }), {
      totalProtocolQuestions: 10,
      callOutcome: "COMPLETED",
    });
    expect(outcome.forced).toBe(false);
    expect(outcome.result.classification).toBe("routine");
  });
});
