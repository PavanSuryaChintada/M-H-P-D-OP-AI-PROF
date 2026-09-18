// Doc 13 §1 — the third, deterministic assessor. Not a fallback: it's the
// only one of the three whose errors are uncorrelated with the two LLMs'.
// Two LLMs agreeing on a wrong answer is exactly the failure PRD §16
// defends against; a keyword/condition matcher over the protocol's own
// red flags can't hallucinate and can't be prompt-injected, so its
// disagreement with the LLMs is informative in a way LLM-vs-LLM
// disagreement isn't.
//
// Deliberately pure and DB-free: it takes the protocol's red flags as a
// plain argument rather than fetching them itself. Doc 11 owns loading
// real structured protocol content; when it lands, it feeds this same
// function real data — nothing here needs to change.

import { SCHEMA_VERSION, type TriageResult } from "../schemas/triage";

export interface RedFlag {
  id: string;
  description: string;
  /** case-insensitive substrings; any match in the transcript or a matching observation triggers this flag */
  triggerKeywords: string[];
  severity: "low" | "moderate" | "high";
  protocolId: string;
  protocolVersion: string;
  /** the knowledge_chunks row this flag's wording comes from, for protocol_reference */
  chunkId: string;
}

export interface TranscriptTurn {
  role: "patient" | "carer" | "agent";
  text: string;
}

export interface StructuredObservation {
  code: string;
  value: string | number;
}

const SEVERITY_TO_CLASSIFICATION: Record<RedFlag["severity"], TriageResult["classification"]> = {
  high: "urgent",
  moderate: "concerning",
  low: "concerning",
};

function findFirstMatch(turns: TranscriptTurn[], keyword: string): { turnIndex: number; excerpt: string } | null {
  const needle = keyword.toLowerCase();
  for (let i = 0; i < turns.length; i++) {
    const idx = turns[i].text.toLowerCase().indexOf(needle);
    if (idx >= 0) {
      return { turnIndex: i, excerpt: turns[i].text.slice(idx, idx + keyword.length) };
    }
  }
  return null;
}

/**
 * Scans the transcript and structured observations for each red flag's
 * trigger keywords. Emits the same TriageResult shape as the LLM
 * assessors, confidence 1.0 for every exact match — a match is a match,
 * there is no probabilistic uncertainty in a deterministic string search.
 */
export function runRuleEngine(
  turns: TranscriptTurn[],
  observations: StructuredObservation[],
  redFlags: RedFlag[],
): TriageResult {
  const matchedIndicators: TriageResult["indicators"] = [];

  for (const flag of redFlags) {
    for (const keyword of flag.triggerKeywords) {
      const transcriptMatch = findFirstMatch(turns, keyword);
      const observationMatch = observations.some((o) => String(o.value).toLowerCase().includes(keyword.toLowerCase()));

      if (transcriptMatch) {
        matchedIndicators.push({
          indicator_id: flag.id,
          description: flag.description,
          severity: flag.severity,
          evidence: { turn_index: transcriptMatch.turnIndex, excerpt: transcriptMatch.excerpt },
          protocol_reference: { chunk_id: flag.chunkId, protocol_id: flag.protocolId, version: flag.protocolVersion },
        });
        break; // one match per flag is enough to record it
      }
      if (observationMatch) {
        matchedIndicators.push({
          indicator_id: flag.id,
          description: flag.description,
          severity: flag.severity,
          evidence: { turn_index: 0, excerpt: keyword },
          protocol_reference: { chunk_id: flag.chunkId, protocol_id: flag.protocolId, version: flag.protocolVersion },
        });
        break;
      }
    }
  }

  const highestSeverity = matchedIndicators.reduce<RedFlag["severity"] | null>((acc, ind) => {
    if (ind.severity === "high") return "high";
    if (ind.severity === "moderate" && acc !== "high") return "moderate";
    if (ind.severity === "low" && acc == null) return "low";
    return acc;
  }, null);

  const classification: TriageResult["classification"] = highestSeverity
    ? SEVERITY_TO_CLASSIFICATION[highestSeverity]
    : "routine";

  return {
    schema_version: SCHEMA_VERSION,
    assessor_id: "rule-engine-v1",
    classification,
    confidence: 1.0, // deterministic exact-match search — certain either way, matched or not
    observations: [],
    indicators: matchedIndicators,
    missing_information: [],
    escalation_recommended: matchedIndicators.length > 0,
    escalation_reason: matchedIndicators.length > 0 ? `matched red flag(s): ${matchedIndicators.map((i) => i.indicator_id).join(", ")}` : undefined,
    reasoning_summary:
      matchedIndicators.length > 0
        ? `Deterministic match on ${matchedIndicators.length} red flag(s).`
        : "No protocol red flag trigger terms found in transcript or observations.",
  };
}
