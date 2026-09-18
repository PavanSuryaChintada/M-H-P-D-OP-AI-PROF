// Doc 13 §2 — the consensus algorithm, implemented exactly as specified,
// in order, first match wins. Pure function: no I/O, no side effects,
// fully unit-testable per rule (tests/consensus.test.ts).
//
// Rule 8 is the point, not an afterthought: the default branch escalates.
// Any case this logic doesn't explicitly recognise as safe is treated as
// needing a human.

import type { AssessorOutcome, Classification } from "./schemas/triage";

const SEVERITY_RANK: Record<Classification, number> = {
  routine: 0,
  concerning: 1,
  uncertain: 2,
  urgent: 3,
};

export type Priority = "HIGH" | "MEDIUM" | "LOW" | null;

export interface EvidenceItem {
  assessorId: string;
  indicatorId: string;
  description: string;
  severity: "low" | "moderate" | "high";
  transcriptExcerpt: string;
  protocolChunkId: string;
}

export interface ConsensusResult {
  escalate: boolean;
  priority: Priority;
  ruleFired: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  reason?: "ASSESSOR_FAILURE" | "MATERIAL_DISAGREEMENT";
  disagreement: boolean;
  disagreementDetail?: string;
  evidence: EvidenceItem[];
}

function collectEvidence(outcomes: AssessorOutcome[]): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  for (const outcome of outcomes) {
    if (outcome.status !== "completed") continue;
    for (const indicator of outcome.result.indicators) {
      evidence.push({
        assessorId: outcome.assessorId,
        indicatorId: indicator.indicator_id,
        description: indicator.description,
        severity: indicator.severity,
        transcriptExcerpt: indicator.evidence.excerpt,
        protocolChunkId: indicator.protocol_reference.chunk_id,
      });
    }
  }
  return evidence;
}

function computeDisagreement(completed: Extract<AssessorOutcome, { status: "completed" }>[]): {
  disagreement: boolean;
  detail?: string;
} {
  const distinctClassifications = new Set(completed.map((a) => a.result.classification));
  if (distinctClassifications.size <= 1) return { disagreement: false };
  const detail = completed.map((a) => `${a.assessorId}: ${a.result.classification}`).join("; ");
  return { disagreement: true, detail };
}

export function computeConsensus(outcomes: AssessorOutcome[]): ConsensusResult {
  const completed = outcomes.filter(
    (o): o is Extract<AssessorOutcome, { status: "completed" }> => o.status === "completed",
  );
  const failed = outcomes.filter((o): o is Extract<AssessorOutcome, { status: "failed" }> => o.status === "failed");
  const evidence = collectEvidence(outcomes);
  const { disagreement, detail: disagreementDetail } = computeDisagreement(completed);

  const base = { disagreement, disagreementDetail, evidence };

  // Rule 1 — any assessor returns urgent.
  if (completed.some((a) => a.result.classification === "urgent")) {
    return { ...base, escalate: true, priority: "HIGH", ruleFired: 1 };
  }

  // Rule 2 — rule engine fires a high-severity red flag, regardless of LLM opinions.
  const ruleEngine = completed.find((a) => a.assessorId === "rule-engine-v1");
  if (ruleEngine?.result.indicators.some((i) => i.severity === "high")) {
    return { ...base, escalate: true, priority: "HIGH", ruleFired: 2 };
  }

  // Rule 3 — any assessor returns uncertain.
  if (completed.some((a) => a.result.classification === "uncertain")) {
    return { ...base, escalate: true, priority: "MEDIUM", ruleFired: 3 };
  }

  // Rule 4 — any assessor failed validation/errored.
  if (failed.length > 0) {
    return {
      ...base,
      escalate: true,
      priority: "MEDIUM",
      ruleFired: 4,
      reason: "ASSESSOR_FAILURE",
      disagreementDetail: base.disagreementDetail ?? `assessor failure: ${failed.map((f) => f.assessorId).join(", ")}`,
    };
  }

  // From here every outcome completed successfully.
  const ranks = completed.map((a) => SEVERITY_RANK[a.result.classification]);
  const maxRank = Math.max(...ranks);
  const minRank = Math.min(...ranks);

  // Rule 5 — material disagreement (e.g. routine vs urgent). NOTE: this
  // example from the spec is actually caught by rule 1 first ("urgent"
  // always fires rule 1), and any "uncertain" is caught by rule 3 first —
  // so by construction, every classification reaching this line is
  // {routine, concerning}, whose rank gap maxes at 1. Rule 5 is therefore
  // unreachable as specified; implemented anyway exactly as written
  // (see tests/consensus.test.ts for the documented reasoning) rather than
  // silently reordered to make it reachable, since the spec says
  // "implement exactly this."
  if (maxRank - minRank >= 2) {
    return { ...base, escalate: true, priority: "MEDIUM", ruleFired: 5, reason: "MATERIAL_DISAGREEMENT" };
  }

  // Rule 6 — majority concerning.
  const concerningCount = completed.filter((a) => a.result.classification === "concerning").length;
  if (concerningCount > completed.length / 2) {
    return { ...base, escalate: true, priority: "LOW", ruleFired: 6 };
  }

  // Rule 7 — unanimous routine, all confident, nothing missing: the ONLY safe, no-escalation branch.
  const allRoutine = completed.every((a) => a.result.classification === "routine");
  const allConfident = completed.every((a) => a.result.confidence >= 0.7);
  const nothingMissing = completed.every((a) => a.result.missing_information.length === 0);
  if (allRoutine && allConfident && nothingMissing) {
    return { ...base, escalate: false, priority: null, ruleFired: 7 };
  }

  // Rule 8 — default-safe. Anything not explicitly recognised as safe escalates.
  return { ...base, escalate: true, priority: "LOW", ruleFired: 8 };
}
