// Doc 12 R4 — the hallucination guard: a fabricated quote (an excerpt that
// doesn't actually appear in the transcript turn it claims to) is
// rejected, not silently accepted.

import { describe, expect, it } from "vitest";
import { verifyTranscriptRefs } from "../lib/ai/triage/verify";
import type { TriageResult } from "../lib/ai/schemas/triage";

function baseResult(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    schema_version: "1.0",
    assessor_id: "test",
    classification: "concerning",
    confidence: 0.8,
    observations: [],
    indicators: [],
    missing_information: [],
    escalation_recommended: false,
    reasoning_summary: "test",
    ...overrides,
  };
}

const TRANSCRIPT = [
  { role: "agent", text: "How are you feeling today?" },
  { role: "patient", text: "I've had some shortness of breath since yesterday." },
];

describe("verifyTranscriptRefs", () => {
  it("accepts an indicator whose excerpt genuinely appears in the referenced turn", () => {
    const result = baseResult({
      indicators: [
        {
          indicator_id: "HF-01",
          description: "dyspnea",
          severity: "moderate",
          evidence: { turn_index: 1, excerpt: "shortness of breath" },
          protocol_reference: { chunk_id: "c1", protocol_id: "p1", version: "1" },
        },
      ],
    });
    expect(verifyTranscriptRefs(result, TRANSCRIPT).valid).toBe(true);
  });

  it("rejects a fabricated quote — an excerpt that does not appear in the referenced turn", () => {
    const result = baseResult({
      indicators: [
        {
          indicator_id: "HF-01",
          description: "chest pain",
          severity: "high",
          evidence: { turn_index: 1, excerpt: "severe chest pain radiating to my arm" },
          protocol_reference: { chunk_id: "c1", protocol_id: "p1", version: "1" },
        },
      ],
    });
    const outcome = verifyTranscriptRefs(result, TRANSCRIPT);
    expect(outcome.valid).toBe(false);
    expect(outcome.errors[0]).toContain("HF-01");
  });

  it("rejects a reference to a turn_index that doesn't exist", () => {
    const result = baseResult({
      indicators: [
        {
          indicator_id: "HF-01",
          description: "x",
          severity: "low",
          evidence: { turn_index: 99, excerpt: "anything" },
          protocol_reference: { chunk_id: "c1", protocol_id: "p1", version: "1" },
        },
      ],
    });
    expect(verifyTranscriptRefs(result, TRANSCRIPT).valid).toBe(false);
  });

  it("accepts an observation whose quote_span is within the referenced turn's bounds", () => {
    const result = baseResult({
      observations: [
        {
          code: "symptom",
          value: "shortness of breath",
          reported_by: "patient",
          transcript_ref: { turn_index: 1, quote_span: [17, 37] },
        },
      ],
    });
    expect(verifyTranscriptRefs(result, TRANSCRIPT).valid).toBe(true);
  });

  it("rejects an observation whose quote_span is out of bounds for the referenced turn", () => {
    const result = baseResult({
      observations: [
        {
          code: "symptom",
          value: "x",
          reported_by: "patient",
          transcript_ref: { turn_index: 1, quote_span: [0, 9999] },
        },
      ],
    });
    expect(verifyTranscriptRefs(result, TRANSCRIPT).valid).toBe(false);
  });

  it("passes trivially when there are no indicators or observations to verify", () => {
    expect(verifyTranscriptRefs(baseResult(), TRANSCRIPT).valid).toBe(true);
  });
});
