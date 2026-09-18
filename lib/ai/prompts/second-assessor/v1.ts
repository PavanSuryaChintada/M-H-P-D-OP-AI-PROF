// Doc 09 §1/§4 / doc 13 §1 — Second Assessor, v1. Same TriageResult schema
// as clinical-triage-v1, deliberately different vendor (GPT, not Claude)
// AND deliberately different framing (symptom-first, not protocol-first) —
// two LLMs converging from different starting points is stronger evidence
// than two runs of the same prompt against the same model.

import { UNTRUSTED_CONTENT_NOTICE } from "../../untrusted";
import type { PromptModule } from "../types";
import type { TriageContext } from "../../context/builders";

const SYSTEM = `You are a second-opinion clinical reviewer reading a post-discharge follow-up call transcript, working independently of any other assessment. You are NOT making a diagnosis or a treatment decision.

Start from the symptoms and concerns the patient actually raised, not from the protocol's question list. Ask yourself: taken together, what do this patient's own words suggest about how they're doing? Then check that against the hospital's protocol (given to you as retrieved chunks) for any matching red flag.

Produce a structured TriageResult:
- classification: one of "routine", "concerning", "urgent", "uncertain"
- confidence: 0-1
- observations: each with a code, value, who reported it, and a transcript_ref (turn_index and the exact quote_span) — every observation must be traceable to an exact quote in the transcript you were given. Never invent or paraphrase a quote.
- indicators: any protocol red flag the transcript matches, with its indicator_id, description, and severity.

If a piece of evidence does not literally appear in the transcript text you were given, do not cite it as a transcript_ref. A fabricated quote is a worse failure than an "uncertain" classification.

${UNTRUSTED_CONTENT_NOTICE}`;

export interface SecondAssessorBuildInput {
  context: TriageContext;
}

export const secondAssessorV1: PromptModule<SecondAssessorBuildInput> = {
  version: "second-assessor-v1",
  system: SYSTEM,
  build: (input) =>
    [
      `What the patient reported, in their own words — read the transcript first:\n${input.context.transcript.map((t, i) => `[${i}] ${t.role}: ${t.text}`).join("\n")}`,
      `Active conditions: ${input.context.activeConditions.join(", ") || "none on record"}`,
      `Current medications: ${input.context.currentMedications.join(", ") || "none on record"}`,
      `Protocol reference (check after forming your own impression):\n${input.context.retrievedChunks.map((c) => `[${c.sourceLabel}] ${c.content}`).join("\n\n")}`,
    ].join("\n\n"),
};
