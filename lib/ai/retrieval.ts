// Doc 11 R4-R8 — tenant-scoped hybrid retrieval. hospital_id always comes
// from TenantContext (never an argument an AI could supply), enforced at
// the SQL level in lib/db/repositories/knowledge-chunks.ts plus RLS as
// the second layer.

import { vectorSearch, keywordSearch, type ChunkSearchResult } from "../db/repositories/knowledge-chunks";
import type { EmbeddingProvider } from "./embeddings/types";
import type { TenantContext } from "../db/tenant";
import type { TriageResult } from "./schemas/triage";

export interface Citation {
  chunk_id: string;
  protocol_id: string;
  protocol_version: string;
  section: string;
  text: string;
}

function toCitation(chunk: ChunkSearchResult): Citation {
  return {
    chunk_id: chunk.id,
    protocol_id: chunk.protocolId ?? "",
    protocol_version: String(chunk.protocolVersion ?? ""),
    section: chunk.section ?? "",
    text: chunk.content,
  };
}

/**
 * Doc 11 R5 — hybrid retrieval: vector similarity (semantic recall) merged
 * with keyword match on the caller-supplied trigger terms (exact-phrase
 * recall a pure vector search can miss — "calf swelling" is the spec's
 * own example). Keyword hits are deliberately ranked first: doc 11's own
 * rationale is that this is the safety-critical path, "exactly what you
 * cannot afford to miss," so an exact red-flag phrase match outranks a
 * merely-similar vector match rather than being averaged into one score.
 */
export async function hybridSearch(
  ctx: TenantContext,
  embeddingProvider: EmbeddingProvider,
  query: string,
  keywordTerms: string[],
  limit: number = 5,
): Promise<Citation[]> {
  const queryEmbedding = await embeddingProvider.embed(query);
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(ctx, queryEmbedding, limit),
    keywordSearch(ctx, keywordTerms, limit),
  ]);

  const merged = new Map<string, ChunkSearchResult>();
  for (const chunk of keywordResults) merged.set(chunk.id, chunk); // keyword hits first — see rationale above
  for (const chunk of vectorResults) if (!merged.has(chunk.id)) merged.set(chunk.id, chunk);

  return [...merged.values()].slice(0, limit).map(toCitation);
}

/** Doc 11 R7 — intake retrieves the question set, not the whole protocol. */
export async function getIntakeQuestions(ctx: TenantContext, embeddingProvider: EmbeddingProvider, protocolTitle: string): Promise<Citation[]> {
  return hybridSearch(ctx, embeddingProvider, `${protocolTitle} follow-up questions`, [], 10);
}

/**
 * Doc 11 R7 — triage retrieves red-flag/severity sections filtered by
 * symptoms actually mentioned, not the whole protocol. `symptoms` doubles
 * as the keyword-search terms, since a symptom the patient actually said
 * is exactly the kind of exact-phrase signal R5 wants prioritized.
 */
export async function getTriageContext(
  ctx: TenantContext,
  embeddingProvider: EmbeddingProvider,
  symptoms: string[],
  limit: number = 5,
): Promise<Citation[]> {
  if (symptoms.length === 0) return [];
  return hybridSearch(ctx, embeddingProvider, symptoms.join(" "), symptoms, limit);
}

export class GroundingViolationError extends Error {
  constructor() {
    super("TriageResult has non-empty indicators but no protocol_references — every clinical claim must cite a retrieved chunk");
    this.name = "GroundingViolationError";
  }
}

/** Doc 11 R8 — post-validation: a TriageResult with non-empty indicators must have every indicator grounded in a real protocol_reference. Throws rather than silently accepting an uncited clinical claim. */
export function assertGrounded(result: TriageResult): void {
  if (result.indicators.length === 0) return;
  const ungrounded = result.indicators.some((i) => !i.protocol_reference.chunk_id || !i.protocol_reference.protocol_id);
  if (ungrounded) throw new GroundingViolationError();
}
