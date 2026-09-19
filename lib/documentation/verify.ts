// Doc 14 R3 — "Apply the same transcript-reference verification as triage."
// Same bounds-check pattern as doc 12's verifyTranscriptRefs for
// observations: a claimed symptom carries a turn_index + quote_span, and an
// out-of-bounds span is the fabrication signature (there's no separate
// claimed-text string to substring-match here, unlike triage indicators).

import type { ModelDocumentationOutput } from "../ai/schemas/documentation";

export interface TranscriptTurn {
  role: string;
  text: string;
}

export interface VerificationResult {
  valid: boolean;
  errors: string[];
}

export function verifyDocumentationRefs(output: ModelDocumentationOutput, transcript: TranscriptTurn[]): VerificationResult {
  const errors: string[] = [];

  for (const symptom of output.patient_reported_symptoms) {
    const ref = symptom.transcript_ref;
    const turn = transcript[ref.turn_index];
    if (!turn) {
      errors.push(`symptom "${symptom.symptom}": turn_index ${ref.turn_index} does not exist in the transcript`);
      continue;
    }
    const [start, end] = ref.quote_span;
    if (start < 0 || end > turn.text.length || start >= end) {
      errors.push(`symptom "${symptom.symptom}": quote_span [${start}, ${end}] is out of bounds for turn ${ref.turn_index} (length ${turn.text.length})`);
    }
  }

  return { valid: errors.length === 0, errors };
}
