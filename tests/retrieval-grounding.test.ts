// Doc 11 R8 — post-validation rejects a TriageResult whose indicators are
// non-empty but whose protocol_references are missing.

import { describe, expect, it } from "vitest";
import { assertGrounded, GroundingViolationError } from "../lib/ai/retrieval";
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

describe("assertGrounded", () => {
  it("passes when there are no indicators", () => {
    expect(() => assertGrounded(result())).not.toThrow();
  });

  it("passes when every indicator has a real protocol_reference", () => {
    const r = result({
      indicators: [
        {
          indicator_id: "HF-01",
          description: "x",
          severity: "low",
          evidence: { turn_index: 0, excerpt: "x" },
          protocol_reference: { chunk_id: "c1", protocol_id: "p1", version: "1" },
        },
      ],
    });
    expect(() => assertGrounded(r)).not.toThrow();
  });

  it("rejects an indicator with an empty protocol_reference", () => {
    const r = result({
      indicators: [
        {
          indicator_id: "HF-01",
          description: "x",
          severity: "low",
          evidence: { turn_index: 0, excerpt: "x" },
          protocol_reference: { chunk_id: "", protocol_id: "", version: "" },
        },
      ],
    });
    expect(() => assertGrounded(r)).toThrow(GroundingViolationError);
  });
});
