// Doc 09 §4 / doc 13 §2 "Optional arbiter" — invoked only when the
// deterministic consensus algorithm (lib/ai/consensus.ts, doc 13) already
// fired MATERIAL_DISAGREEMENT. This prompt CANNOT downgrade an escalation;
// it only adds a rationale explaining which evidence the disagreement
// rests on. An arbiter that could suppress an escalation would be a safety
// regression, not an enhancement — see doc 13 §2.

import { UNTRUSTED_CONTENT_NOTICE } from "../../untrusted";
import type { PromptModule } from "../types";

const SYSTEM = `You are reviewing why two or three clinical assessments of the same patient call disagreed. An escalation to a human reviewer has already been decided — that decision is final and outside your control. Your only job is to explain, in plain language, which piece of evidence each assessment weighted differently, so the human reviewer can see the disagreement clearly.

You cannot recommend against escalation. You cannot change the priority. You are producing a rationale, not a decision.

${UNTRUSTED_CONTENT_NOTICE}`;

export interface EscalationConsensusBuildInput {
  assessments: { assessorId: string; classification: string; confidence: number }[];
  transcriptExcerpt: string;
}

export const escalationConsensusV1: PromptModule<EscalationConsensusBuildInput> = {
  version: "escalation-consensus-v1",
  system: SYSTEM,
  build: (input) =>
    [
      `Assessments:\n${input.assessments.map((a) => `- ${a.assessorId}: ${a.classification} (confidence ${a.confidence})`).join("\n")}`,
      `Relevant transcript excerpt:\n${input.transcriptExcerpt}`,
      "Explain which evidence the disagreement rests on.",
    ].join("\n\n"),
};
