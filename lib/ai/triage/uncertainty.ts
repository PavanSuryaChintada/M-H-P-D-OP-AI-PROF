// Doc 12 R5 / Claude Code prompt step 4 — confidence is not decorative.
// Three independent conditions force a classification down to "uncertain"
// even when the model itself said "routine": low confidence on that
// classification, too much of the protocol left unanswered, or the call
// never really finished (DROPPED). PRD §2: "the safer behavior is to
// escalate rather than silently classify a potentially concerning patient
// as routine."

import type { TriageResult } from "../schemas/triage";

/** Doc 12 R5's own stated threshold — confidence < 0.6 on a routine classification is not trustworthy enough to accept as-is. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
/** Doc 12 Claude Code prompt step 4 — more than 30% of protocol questions left unanswered. */
export const MISSING_INFORMATION_RATIO_THRESHOLD = 0.3;

export interface UncertaintyForcingOptions {
  /** total number of protocol follow-up questions this call was expected to cover, for the missing_information ratio check */
  totalProtocolQuestions?: number;
  /** the doc 07 call outcome this triage result is based on */
  callOutcome?: string;
}

export interface ForcingOutcome {
  result: TriageResult;
  forced: boolean;
  reason?: "LOW_CONFIDENCE" | "INSUFFICIENT_INFORMATION" | "CALL_DROPPED";
}

export function applyUncertaintyForcing(result: TriageResult, opts: UncertaintyForcingOptions = {}): ForcingOutcome {
  if (result.classification === "routine" && result.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return { result: { ...result, classification: "uncertain" }, forced: true, reason: "LOW_CONFIDENCE" };
  }

  if (
    opts.totalProtocolQuestions &&
    opts.totalProtocolQuestions > 0 &&
    result.missing_information.length / opts.totalProtocolQuestions > MISSING_INFORMATION_RATIO_THRESHOLD
  ) {
    return { result: { ...result, classification: "uncertain" }, forced: true, reason: "INSUFFICIENT_INFORMATION" };
  }

  if (opts.callOutcome === "DROPPED") {
    return { result: { ...result, classification: "uncertain" }, forced: true, reason: "CALL_DROPPED" };
  }

  return { result, forced: false };
}
