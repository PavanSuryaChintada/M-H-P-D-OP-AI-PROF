// Doc 13 §2 — one test per consensus rule, in the order they're specified,
// plus the acceptance-criteria case: a transcript with a protocol
// red-flag phrase escalates even when both LLMs return routine.

import { describe, expect, it } from "vitest";
import { computeConsensus } from "../lib/ai/consensus";
import type { AssessorOutcome, TriageResult } from "../lib/ai/schemas/triage";

function result(overrides: Partial<TriageResult> & Pick<TriageResult, "classification">): TriageResult {
  return {
    schema_version: "1.0",
    assessor_id: "test-assessor",
    confidence: 0.9,
    observations: [],
    indicators: [],
    missing_information: [],
    escalation_recommended: false,
    reasoning_summary: "test",
    ...overrides,
  };
}

function completed(assessorId: string, r: Partial<TriageResult> & Pick<TriageResult, "classification">): AssessorOutcome {
  return { assessorId, status: "completed", result: result({ assessor_id: assessorId, ...r }) };
}

function failed(assessorId: string, errorDetail = "provider error"): AssessorOutcome {
  return { assessorId, status: "failed", errorDetail };
}

const HIGH_RED_FLAG_INDICATOR: TriageResult["indicators"][number] = {
  indicator_id: "HF-04",
  description: "weight gain >2kg in 3 days",
  severity: "high",
  evidence: { turn_index: 2, excerpt: "gained about two kilos" },
  protocol_reference: { chunk_id: "chunk-1", protocol_id: "proto-cardiac", version: "1" },
};

describe("computeConsensus — the 8 rules, in order", () => {
  it("rule 1: any assessor returns urgent -> ESCALATE, priority HIGH", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine" }),
      completed("gpt-triage-v1", { classification: "urgent" }),
      completed("rule-engine-v1", { classification: "routine" }),
    ]);
    expect(outcome.escalate).toBe(true);
    expect(outcome.priority).toBe("HIGH");
    expect(outcome.ruleFired).toBe(1);
  });

  it("rule 2: rule engine fires a high-severity red flag, regardless of LLM opinions -> ESCALATE, priority HIGH", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine" }),
      completed("gpt-triage-v1", { classification: "routine" }),
      completed("rule-engine-v1", { classification: "concerning", indicators: [HIGH_RED_FLAG_INDICATOR] }),
    ]);
    expect(outcome.escalate).toBe(true);
    expect(outcome.priority).toBe("HIGH");
    expect(outcome.ruleFired).toBe(2);
  });

  it("acceptance criteria: both LLMs say routine, rule engine matches a high-severity red flag -> still escalates", () => {
    // runRuleEngine (lib/ai/assessors/rule-engine.ts) always sets
    // classification "urgent" when any high-severity indicator matches, so
    // a REAL rule-engine output here would already fire rule 1 on its own
    // — rule 2 exists as a belt-and-suspenders check for any
    // AssessorOutcome producer that doesn't. To exercise rule 2
    // specifically (not rule 1), this fixture decouples the two on
    // purpose: a classification that isn't "urgent" but indicators that
    // are still high-severity, which consensus.ts's contract allows since
    // it never assumes the two are consistent.
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine", confidence: 0.95 }),
      completed("gpt-triage-v1", { classification: "routine", confidence: 0.9 }),
      completed("rule-engine-v1", { classification: "concerning", indicators: [HIGH_RED_FLAG_INDICATOR] }),
    ]);
    expect(outcome.escalate).toBe(true);
    expect(outcome.ruleFired).toBe(2);
    expect(outcome.evidence.some((e) => e.indicatorId === "HF-04")).toBe(true);
  });

  it("rule 3: any assessor returns uncertain -> ESCALATE, priority MEDIUM", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "uncertain" }),
      completed("gpt-triage-v1", { classification: "routine" }),
      completed("rule-engine-v1", { classification: "routine" }),
    ]);
    expect(outcome.escalate).toBe(true);
    expect(outcome.priority).toBe("MEDIUM");
    expect(outcome.ruleFired).toBe(3);
  });

  it("rule 4: an assessor failed validation/errored -> ESCALATE, priority MEDIUM, reason ASSESSOR_FAILURE", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine" }),
      failed("gpt-triage-v1"),
      completed("rule-engine-v1", { classification: "routine" }),
    ]);
    expect(outcome.escalate).toBe(true);
    expect(outcome.priority).toBe("MEDIUM");
    expect(outcome.ruleFired).toBe(4);
    expect(outcome.reason).toBe("ASSESSOR_FAILURE");
  });

  // Rule 5 ("max severity_rank - min severity_rank >= 2") is structurally
  // unreachable given the spec's own rule ordering, not a bug in this
  // implementation: severity_rank is {routine:0, concerning:1, uncertain:2,
  // urgent:3}, but any "urgent" already fires rule 1 and any "uncertain"
  // already fires rule 3, both *before* rule 5 is ever evaluated. By the
  // time execution reaches rule 5, every completed assessor's
  // classification is restricted to {routine, concerning} — a maximum
  // possible gap of 1. Implemented exactly as specified anyway (rule
  // ordering is explicit in the doc); documented here rather than silently
  // reordered, per doc 00's "if you find a spec bug, document it, don't
  // quietly resolve it differently."
  it("rule 5 is unreachable as specified — the widest gap possible once rules 1/3 have already excluded urgent/uncertain is routine-vs-concerning (gap 1), never >= 2", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine" }),
      completed("gpt-triage-v1", { classification: "concerning" }),
      completed("rule-engine-v1", { classification: "routine" }),
    ]);
    expect(outcome.ruleFired).not.toBe(5);
  });

  it("rule 6: majority concerning -> ESCALATE, priority LOW", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "concerning" }),
      completed("gpt-triage-v1", { classification: "concerning" }),
      completed("rule-engine-v1", { classification: "routine" }),
    ]);
    expect(outcome.escalate).toBe(true);
    expect(outcome.priority).toBe("LOW");
    expect(outcome.ruleFired).toBe(6);
  });

  it("rule 7: unanimous routine, all confidences >= 0.7, nothing missing -> NO ESCALATION", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine", confidence: 0.9, missing_information: [] }),
      completed("gpt-triage-v1", { classification: "routine", confidence: 0.8, missing_information: [] }),
      completed("rule-engine-v1", { classification: "routine", confidence: 1.0, missing_information: [] }),
    ]);
    expect(outcome.escalate).toBe(false);
    expect(outcome.priority).toBeNull();
    expect(outcome.ruleFired).toBe(7);
  });

  it("rule 7 boundary: unanimous routine but one confidence below 0.7 does NOT qualify for rule 7 -> falls to rule 8", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine", confidence: 0.5 }),
      completed("gpt-triage-v1", { classification: "routine", confidence: 0.9 }),
      completed("rule-engine-v1", { classification: "routine", confidence: 1.0 }),
    ]);
    expect(outcome.escalate).toBe(true);
    expect(outcome.ruleFired).toBe(8);
  });

  it("rule 7 boundary: unanimous routine, confident, but missing_information present -> falls to rule 8", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine", confidence: 0.9, missing_information: ["pain scale"] }),
      completed("gpt-triage-v1", { classification: "routine", confidence: 0.9, missing_information: [] }),
      completed("rule-engine-v1", { classification: "routine", confidence: 1.0, missing_information: [] }),
    ]);
    expect(outcome.escalate).toBe(true);
    expect(outcome.ruleFired).toBe(8);
  });

  it("rule 8: default-safe — anything not explicitly recognised as safe escalates, priority LOW", () => {
    // Not unanimous routine (one concerning, but not majority since only 1 of 3) — no earlier rule fires.
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine", confidence: 0.9 }),
      completed("gpt-triage-v1", { classification: "concerning", confidence: 0.9 }),
      completed("rule-engine-v1", { classification: "routine", confidence: 1.0 }),
    ]);
    expect(outcome.escalate).toBe(true);
    expect(outcome.priority).toBe("LOW");
    expect(outcome.ruleFired).toBe(8);
  });

  it("records disagreement and its detail whenever classifications differ, regardless of which rule fired", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine" }),
      completed("gpt-triage-v1", { classification: "urgent" }),
      completed("rule-engine-v1", { classification: "routine" }),
    ]);
    expect(outcome.disagreement).toBe(true);
    expect(outcome.disagreementDetail).toContain("urgent");
  });

  it("records no disagreement when all assessors agree", () => {
    const outcome = computeConsensus([
      completed("claude-triage-v1", { classification: "routine" }),
      completed("gpt-triage-v1", { classification: "routine" }),
      completed("rule-engine-v1", { classification: "routine" }),
    ]);
    expect(outcome.disagreement).toBe(false);
  });
});
