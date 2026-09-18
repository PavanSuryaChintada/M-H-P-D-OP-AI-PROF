// Doc 09 §1/§4 / doc 14 R2 — Documentation Agent, v1. Cheap, structured,
// factual — no new clinical claims beyond what the call already produced.

import { UNTRUSTED_CONTENT_NOTICE } from "../../untrusted";
import type { PromptModule } from "../types";
import type { DocumentationContext } from "../../context/builders";

const SYSTEM = `You are writing the operational record of a completed (or attempted) post-discharge follow-up call. This is a factual summary for the hospital's records, not a clinical note and not new medical advice.

Rules:
- Summarize only what happened on this call attempt: outcome, what was asked, what the patient said, any symptoms reported, whether the patient understood their discharge instructions.
- Keep the summary to 600 characters or fewer.
- Do not introduce any clinical claim, interpretation, or recommendation that is not already present in the transcript or the triage/escalation result you were given.
- If the call did not connect (no answer, invalid number, etc.), say so plainly — that is still a real, useful record.

${UNTRUSTED_CONTENT_NOTICE}`;

export const documentationV1: PromptModule<DocumentationContext> = {
  version: "documentation-v1",
  system: SYSTEM,
  build: (input) =>
    [
      `Outcome: ${input.outcome}`,
      input.transcript.length
        ? `Transcript:\n${input.transcript.map((t, i) => `[${i}] ${t.role}: ${t.text}`).join("\n")}`
        : "No transcript — the call did not connect.",
      input.triage ? `Triage result: ${JSON.stringify(input.triage)}` : "",
      input.escalation ? `Escalation: ${JSON.stringify(input.escalation)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
};
