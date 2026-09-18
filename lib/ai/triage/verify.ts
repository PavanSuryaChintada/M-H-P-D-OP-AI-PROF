// Doc 12 R3/R4 — the hallucination guard. "If the model claims the patient
// said something, the quoted excerpt must actually appear in that turn.
// Reject if not." This is checked AFTER schema validation (which only
// confirms the shape is right, not that any of it is true) and is what
// actually catches a fabricated quote — the cheapest, strongest
// anti-hallucination control available, per the spec.

import type { TriageResult } from "../schemas/triage";

export interface TranscriptTurn {
  role: string;
  text: string;
}

export interface VerificationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Indicators carry a literal excerpt string the model claims appears in a
 * specific turn — checked with a direct substring search, the strongest
 * check available (doc 12 R4). Observations instead carry a turn_index +
 * quote_span (position indices), which are checked for being in-bounds
 * within that turn's actual text; there's no separate claimed-text string
 * to verify against for observations, so an out-of-bounds span is the
 * fabrication signature there.
 */
export function verifyTranscriptRefs(result: TriageResult, transcript: TranscriptTurn[]): VerificationResult {
  const errors: string[] = [];

  for (const indicator of result.indicators) {
    const turn = transcript[indicator.evidence.turn_index];
    if (!turn) {
      errors.push(`indicator ${indicator.indicator_id}: turn_index ${indicator.evidence.turn_index} does not exist in the transcript`);
      continue;
    }
    if (!turn.text.toLowerCase().includes(indicator.evidence.excerpt.toLowerCase())) {
      errors.push(
        `indicator ${indicator.indicator_id}: excerpt "${indicator.evidence.excerpt}" was not found in turn ${indicator.evidence.turn_index}`,
      );
    }
  }

  for (const observation of result.observations) {
    const ref = observation.transcript_ref;
    const turn = transcript[ref.turn_index];
    if (!turn) {
      errors.push(`observation ${observation.code}: turn_index ${ref.turn_index} does not exist in the transcript`);
      continue;
    }
    const [start, end] = ref.quote_span;
    if (start < 0 || end > turn.text.length || start >= end) {
      errors.push(`observation ${observation.code}: quote_span [${start}, ${end}] is out of bounds for turn ${ref.turn_index} (length ${turn.text.length})`);
    }
  }

  // Doc 12 R3 grounding check — non-empty indicators require a real
  // protocol_reference. The schema already makes protocol_reference a
  // required field per indicator, so a schema-valid result has already
  // passed this; kept as an explicit, separate assertion here so the
  // check is legible on its own rather than implicit in a zod shape.
  for (const indicator of result.indicators) {
    if (!indicator.protocol_reference.chunk_id || !indicator.protocol_reference.protocol_id) {
      errors.push(`indicator ${indicator.indicator_id}: missing protocol_reference — an indicator must cite the protocol chunk it came from`);
    }
  }

  return { valid: errors.length === 0, errors };
}
