// Doc 13 §1 — the deterministic assessor. Confidence 1.0 always (a
// deterministic string search is never uncertain about whether it found a
// match), matches transcripts and structured observations, and maps
// severity -> classification.

import { describe, expect, it } from "vitest";
import { runRuleEngine, type RedFlag } from "../lib/ai/assessors/rule-engine";

const HF04: RedFlag = {
  id: "HF-04",
  description: "weight gain >2kg in 3 days",
  triggerKeywords: ["gained two kilos", "weight gain"],
  severity: "high",
  protocolId: "proto-cardiac",
  protocolVersion: "1",
  chunkId: "chunk-hf04",
};

const LOW_FLAG: RedFlag = {
  id: "GEN-01",
  description: "mild fatigue",
  triggerKeywords: ["a bit tired"],
  severity: "low",
  protocolId: "proto-general",
  protocolVersion: "1",
  chunkId: "chunk-gen01",
};

describe("runRuleEngine", () => {
  it("returns routine, confidence 1.0, no indicators when nothing matches", () => {
    const result = runRuleEngine([{ role: "patient", text: "I feel completely fine today." }], [], [HF04]);
    expect(result.classification).toBe("routine");
    expect(result.confidence).toBe(1.0);
    expect(result.indicators).toHaveLength(0);
    expect(result.escalation_recommended).toBe(false);
    expect(result.assessor_id).toBe("rule-engine-v1");
  });

  it("matches a trigger keyword in the transcript and classifies by severity (high -> urgent)", () => {
    const result = runRuleEngine(
      [{ role: "patient", text: "I noticed I gained two kilos since Monday." }],
      [],
      [HF04],
    );
    expect(result.classification).toBe("urgent");
    expect(result.confidence).toBe(1.0);
    expect(result.indicators).toHaveLength(1);
    expect(result.indicators[0].indicator_id).toBe("HF-04");
    expect(result.indicators[0].evidence.turn_index).toBe(0);
    expect(result.escalation_recommended).toBe(true);
  });

  it("matches via a structured observation, not just the transcript", () => {
    const result = runRuleEngine([{ role: "patient", text: "nothing unusual" }], [{ code: "note", value: "weight gain noted" }], [HF04]);
    expect(result.indicators).toHaveLength(1);
    expect(result.classification).toBe("urgent");
  });

  it("is case-insensitive", () => {
    const result = runRuleEngine([{ role: "patient", text: "I GAINED TWO KILOS this week." }], [], [HF04]);
    expect(result.indicators).toHaveLength(1);
  });

  it("maps low severity to concerning, not routine", () => {
    const result = runRuleEngine([{ role: "patient", text: "I've been a bit tired lately." }], [], [LOW_FLAG]);
    expect(result.classification).toBe("concerning");
  });

  it("picks the highest severity across multiple matched flags", () => {
    const result = runRuleEngine(
      [{ role: "patient", text: "I've been a bit tired and I gained two kilos." }],
      [],
      [LOW_FLAG, HF04],
    );
    expect(result.classification).toBe("urgent");
    expect(result.indicators).toHaveLength(2);
  });

  it("every indicator carries a protocol_reference the reviewer can trace back to a chunk", () => {
    const result = runRuleEngine([{ role: "patient", text: "gained two kilos" }], [], [HF04]);
    expect(result.indicators[0].protocol_reference).toEqual({
      chunk_id: "chunk-hf04",
      protocol_id: "proto-cardiac",
      version: "1",
    });
  });
});
