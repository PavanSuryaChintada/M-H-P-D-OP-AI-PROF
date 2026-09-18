// Doc 11 R3 — chunks by structural unit (one red flag, one batch of
// follow-up questions, one guidance item) rather than naively splitting
// arbitrary prose into fixed-size windows. This keeps each chunk
// semantically coherent (a red flag's trigger terms and required action
// never get split across two chunks) and makes {protocol_id, section,
// heading} fall out of the structure directly instead of being inferred
// from free text. 200-400 tokens is the spec's target size; actual chunk
// sizes here are governed by their structural unit's natural size, which
// in practice lands in that range for real protocol content.

import type { StructuredProtocol } from "./schema";

export interface ProtocolChunk {
  sourceLabel: string;
  section: string;
  heading: string;
  content: string;
}

export function chunkProtocol(title: string, protocol: StructuredProtocol): ProtocolChunk[] {
  const chunks: ProtocolChunk[] = [
    {
      section: "Overview",
      heading: title,
      sourceLabel: "overview",
      content: `${title}. Specialty: ${protocol.specialty}. Version ${protocol.version}, effective ${protocol.effectiveFrom}.`,
    },
  ];

  for (const flag of protocol.redFlags) {
    chunks.push({
      section: "Red Flags",
      heading: flag.description,
      sourceLabel: `red_flag:${flag.id}`,
      content: `Red flag ${flag.id}: ${flag.description}. Severity: ${flag.severity}. Trigger terms: ${flag.triggerKeywords.join(", ")}. Required action: ${flag.requiredAction}.`,
    });
  }

  const QUESTIONS_PER_CHUNK = 4;
  for (let i = 0; i < protocol.followUpQuestions.length; i += QUESTIONS_PER_CHUNK) {
    const batch = protocol.followUpQuestions.slice(i, i + QUESTIONS_PER_CHUNK);
    chunks.push({
      section: "Follow-Up Questions",
      heading: `Questions ${i + 1}-${i + batch.length}`,
      sourceLabel: `follow_up_questions:${i + 1}-${i + batch.length}`,
      content: batch
        .map(
          (q) =>
            `${q.id}: ${q.text} (${q.answerType})` +
            (q.probeQuestions.length ? ` Probes: ${q.probeQuestions.map((p) => p.text).join("; ")}` : ""),
        )
        .join("\n"),
    });
  }

  for (const guidance of protocol.approvedGuidance) {
    chunks.push({
      section: "Approved Guidance",
      heading: guidance.topic,
      sourceLabel: `guidance:${guidance.id}`,
      content: guidance.text,
    });
  }

  chunks.push({
    section: "Escalation Rules",
    heading: "Escalation priority mapping",
    sourceLabel: "escalation_rules",
    content: protocol.escalationRules.map((r) => `${r.condition} -> priority ${r.priority}`).join("\n"),
  });

  return chunks;
}

/** Renders the structured form into readable prose — this is what's stored in protocols.content (doc 11 R1's "store both the structured form and the source document") and what gets chunked above. */
export function renderProtocolDocument(title: string, protocol: StructuredProtocol): string {
  const lines: string[] = [`# ${title}`, "", `Specialty: ${protocol.specialty}`, `Version: ${protocol.version}`, `Effective from: ${protocol.effectiveFrom}`, ""];

  lines.push("## Follow-Up Questions");
  for (const q of protocol.followUpQuestions) {
    lines.push(`- ${q.id}. ${q.text} [${q.answerType}]`);
    for (const p of q.probeQuestions) lines.push(`  - probe: ${p.text}`);
  }

  lines.push("", "## Red Flags");
  for (const flag of protocol.redFlags) {
    lines.push(`- ${flag.id} (${flag.severity}): ${flag.description} — triggers: ${flag.triggerKeywords.join(", ")} — action: ${flag.requiredAction}`);
  }

  lines.push("", "## Approved Guidance");
  for (const g of protocol.approvedGuidance) {
    lines.push(`- ${g.topic}: ${g.text}`);
  }

  lines.push("", "## Escalation Rules");
  for (const r of protocol.escalationRules) {
    lines.push(`- ${r.condition} -> ${r.priority}`);
  }

  return lines.join("\n");
}
