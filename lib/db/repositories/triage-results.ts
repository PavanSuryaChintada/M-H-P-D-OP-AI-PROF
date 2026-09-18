// Doc 12 R7 — traceability persistence for every triage assessment: raw
// output, parsed/validated result, prompt version, model, retrieval chunk
// ids, validation attempt count, latency, cost. One row per assessor per
// call attempt (this is the durable record; escalation_assessments, doc
// 13, is a snapshot taken specifically at consensus time and can reference
// these rows but doesn't replace them).

import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { triageResults } from "../schema";
import type { TriageResult } from "../../ai/schemas/triage";

export interface CreateTriageResultInput {
  callId: string;
  patientId: string;
  result: TriageResult;
  modelProvider: string; // "anthropic" | "openai" | "rule-engine"
  modelName?: string;
  promptVersion?: string;
  rawOutput?: unknown;
  retrievalChunkIds?: string[];
  validationAttempts?: number;
  latencyMs?: number;
  estimatedCostUsd?: number;
}

const CLASSIFICATION_TO_DB: Record<string, "ROUTINE" | "CONCERNING" | "URGENT" | "UNCERTAIN"> = {
  routine: "ROUTINE",
  concerning: "CONCERNING",
  urgent: "URGENT",
  uncertain: "UNCERTAIN",
};

export async function createTriageResult(ctx: TenantContext, input: CreateTriageResultInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(triageResults)
      .values({
        hospitalId: ctx.hospitalId,
        callId: input.callId,
        patientId: input.patientId,
        classification: CLASSIFICATION_TO_DB[input.result.classification],
        observedIndicators: input.result.indicators,
        evidence: input.result.observations,
        protocolReferences: input.result.indicators.map((i) => i.protocol_reference),
        confidence: String(input.result.confidence),
        escalationRecommended: input.result.escalation_recommended,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        promptVersion: input.promptVersion,
        rawOutput: input.rawOutput,
        parsedResult: input.result,
        retrievalChunkIds: input.retrievalChunkIds ?? [],
        validationAttempts: input.validationAttempts ?? 1,
        latencyMs: input.latencyMs,
        estimatedCostUsd: input.estimatedCostUsd != null ? String(input.estimatedCostUsd) : undefined,
      })
      .returning();
    return row;
  });
}

export async function listTriageResultsForCall(ctx: TenantContext, callId: string) {
  return withTenant(ctx, async (tx) => tx.select().from(triageResults).where(eq(triageResults.callId, callId)));
}
