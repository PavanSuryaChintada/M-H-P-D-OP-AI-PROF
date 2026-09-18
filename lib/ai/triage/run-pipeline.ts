// Doc 12 + Doc 13, tied together — the actual end-to-end entry point a
// completed call hands off to: run all three assessors (Claude, GPT, rule
// engine) in parallel via Promise.allSettled, then hand their outcomes to
// doc 13's consensus algorithm, which decides whether to escalate and
// persists if so. This is the function doc 10 (voice intake / call
// handling) calls once a call ends.

import type { AIProvider } from "../providers/types";
import type { TenantContext } from "../../db/tenant";
import type { RedFlag, TranscriptTurn as RuleEngineTurn, StructuredObservation } from "../assessors/rule-engine";
import { runRuleEngine } from "../assessors/rule-engine";
import { runTriageAssessor } from "./run-assessor";
import { clinicalTriageV1 } from "../prompts/clinical-triage/v1";
import { secondAssessorV1 } from "../prompts/second-assessor/v1";
import { buildTriageContext, type TriageContext } from "../context/builders";
import { settleAssessors, escalateFromConsensus, type EscalateFromConsensusResult } from "../run-consensus";
import type { UncertaintyForcingOptions } from "./uncertainty";

function withRepairContext(basePrompt: string, repairContext?: { previousError: string }): string {
  if (!repairContext) return basePrompt;
  return [
    basePrompt,
    "",
    `Your previous attempt failed validation: ${repairContext.previousError}`,
    "Correct your response. Every indicator's evidence.excerpt must be an exact substring of the transcript turn you reference in evidence.turn_index. Every indicator needs a real protocol_reference.",
  ].join("\n");
}

export interface RunTriagePipelineInput {
  ctx: TenantContext;
  callId: string;
  patientId: string;
  transcript: RuleEngineTurn[];
  structuredObservations: StructuredObservation[];
  retrievedChunks: TriageContext["retrievedChunks"];
  redFlags: RedFlag[];
  claudeProvider: AIProvider;
  claudeModel: string;
  gptProvider: AIProvider;
  gptModel: string;
  campaignId?: string;
  outreachTaskId?: string;
  attemptNumber?: number;
  uncertaintyOptions?: UncertaintyForcingOptions;
}

export async function runTriagePipeline(input: RunTriagePipelineInput): Promise<EscalateFromConsensusResult> {
  const context = await buildTriageContext(input.ctx, input.patientId, input.transcript, input.retrievedChunks);

  const outcomes = await settleAssessors([
    {
      assessorId: "claude-triage-v1",
      run: () =>
        runTriageAssessor({
          assessorId: "claude-triage-v1",
          agentLabel: "clinical_triage",
          provider: input.claudeProvider,
          model: input.claudeModel,
          system: clinicalTriageV1.system,
          buildPrompt: (repair) => withRepairContext(clinicalTriageV1.build({ context }), repair),
          promptVersion: clinicalTriageV1.version,
          transcript: input.transcript,
          ctx: input.ctx,
          callId: input.callId,
          patientId: input.patientId,
          uncertaintyOptions: input.uncertaintyOptions,
        }),
    },
    {
      assessorId: "gpt-triage-v1",
      run: () =>
        runTriageAssessor({
          assessorId: "gpt-triage-v1",
          agentLabel: "second_assessor",
          provider: input.gptProvider,
          model: input.gptModel,
          system: secondAssessorV1.system,
          buildPrompt: (repair) => withRepairContext(secondAssessorV1.build({ context }), repair),
          promptVersion: secondAssessorV1.version,
          transcript: input.transcript,
          ctx: input.ctx,
          callId: input.callId,
          patientId: input.patientId,
          uncertaintyOptions: input.uncertaintyOptions,
        }),
    },
    {
      assessorId: "rule-engine-v1",
      // Wrapped as async to go through the same Promise.allSettled path as
      // the two LLM assessors, even though a pure function can't really
      // reject — uniform handling, not a functional requirement.
      run: () => Promise.resolve(runRuleEngine(input.transcript, input.structuredObservations, input.redFlags)),
    },
  ]);

  return escalateFromConsensus(
    input.ctx,
    {
      patientId: input.patientId,
      campaignId: input.campaignId,
      callId: input.callId,
      outreachTaskId: input.outreachTaskId,
      attemptNumber: input.attemptNumber,
    },
    outcomes,
  );
}
