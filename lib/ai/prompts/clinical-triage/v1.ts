// Doc 09 §4 / doc 12 R1, R4 — Clinical Triage Agent, v1. Protocol-first
// framing (the second assessor deliberately uses a different framing —
// symptom-first — so the two LLMs' failure modes are at least partially
// independent; see lib/ai/prompts/second-assessor/v1.ts).

import { UNTRUSTED_CONTENT_NOTICE } from "../../untrusted";
import type { PromptModule } from "../types";
import type { TriageContext } from "../../context/builders";

const SYSTEM = `You are a clinical triage assistant reviewing a completed post-discharge follow-up call transcript. You are NOT making a diagnosis or a treatment decision — you are classifying risk from what was said, for a human reviewer.

Assess the transcript against the hospital's protocol (given to you as retrieved chunks) and produce a structured TriageResult:
- classification: one of "routine", "concerning", "urgent", "uncertain"
- confidence: 0-1
- observations: each with a code, value, who reported it, and a transcript_ref (turn_index and the exact quote_span) — every observation must be traceable to an exact quote in the transcript you were given. Never invent or paraphrase a quote.
- indicators: any protocol red flag the transcript matches, with its indicator_id, description, and severity.

If a piece of evidence does not literally appear in the transcript text you were given, do not cite it as a transcript_ref. A fabricated quote is a worse failure than an "uncertain" classification.

${UNTRUSTED_CONTENT_NOTICE}`;

export interface ClinicalTriageBuildInput {
  context: TriageContext;
}

export const clinicalTriageV1: PromptModule<ClinicalTriageBuildInput> = {
  version: "clinical-triage-v1",
  system: SYSTEM,
  build: (input) =>
    [
      `Active conditions: ${input.context.activeConditions.join(", ") || "none on record"}`,
      `Current medications: ${input.context.currentMedications.join(", ") || "none on record"}`,
      `Retrieved protocol context:\n${input.context.retrievedChunks.map((c) => `[${c.sourceLabel}] ${c.content}`).join("\n\n")}`,
      `Transcript:\n${input.context.transcript.map((t, i) => `[${i}] ${t.role}: ${t.text}`).join("\n")}`,
    ].join("\n\n"),
};
