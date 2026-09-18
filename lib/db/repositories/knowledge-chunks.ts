// Doc 11 R3/R4 — chunk storage and the two retrieval primitives hybrid
// search combines: vector similarity and keyword match. hospital_id is
// always ctx.hospitalId, never a caller-supplied argument (R4's hard
// rule) — every query here is scoped through withTenant()'s RLS-armed
// transaction, the same pattern every other repository uses, plus RLS
// itself as the second layer per R4.

import { and, cosineDistance, desc, eq, ilike, or, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { knowledgeChunks } from "../schema";

export interface CreateKnowledgeChunkInput {
  protocolId: string;
  protocolVersion: number;
  sourceLabel: string;
  section: string;
  heading: string;
  content: string;
  embedding: number[];
}

export async function createKnowledgeChunks(ctx: TenantContext, inputs: CreateKnowledgeChunkInput[]) {
  return withTenant(ctx, async (tx) => {
    if (inputs.length === 0) return [];
    return tx
      .insert(knowledgeChunks)
      .values(inputs.map((i) => ({ ...i, hospitalId: ctx.hospitalId })))
      .returning();
  });
}

export interface ChunkSearchResult {
  id: string;
  protocolId: string | null;
  protocolVersion: number | null;
  section: string | null;
  heading: string | null;
  content: string;
  distance?: number;
}

/**
 * Doc 11 R4 — tenant-scoped at the SQL level: hospital_id = ctx.hospitalId
 * is a where-clause parameter, never accepted as a function argument from
 * AI-facing code. `<=>` (cosine distance) via drizzle's cosineDistance —
 * lower is more similar.
 */
export async function vectorSearch(ctx: TenantContext, queryEmbedding: number[], limit: number): Promise<ChunkSearchResult[]> {
  return withTenant(ctx, async (tx) => {
    const distance = cosineDistance(knowledgeChunks.embedding, queryEmbedding);
    return tx
      .select({
        id: knowledgeChunks.id,
        protocolId: knowledgeChunks.protocolId,
        protocolVersion: knowledgeChunks.protocolVersion,
        section: knowledgeChunks.section,
        heading: knowledgeChunks.heading,
        content: knowledgeChunks.content,
        distance: sql<number>`${distance}`,
      })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.hospitalId, ctx.hospitalId))
      .orderBy(sql`${distance}`)
      .limit(limit);
  });
}

/** Doc 11 R5 — the keyword half of hybrid search: exact-phrase matches on red-flag trigger terms that a pure vector search can miss (e.g. "calf swelling"). */
export async function keywordSearch(ctx: TenantContext, terms: string[], limit: number): Promise<ChunkSearchResult[]> {
  if (terms.length === 0) return [];
  return withTenant(ctx, async (tx) => {
    const patterns = terms.map((t) => ilike(knowledgeChunks.content, `%${t}%`));
    return tx
      .select({
        id: knowledgeChunks.id,
        protocolId: knowledgeChunks.protocolId,
        protocolVersion: knowledgeChunks.protocolVersion,
        section: knowledgeChunks.section,
        heading: knowledgeChunks.heading,
        content: knowledgeChunks.content,
      })
      .from(knowledgeChunks)
      .where(and(eq(knowledgeChunks.hospitalId, ctx.hospitalId), or(...patterns)))
      .orderBy(desc(knowledgeChunks.createdAt))
      .limit(limit);
  });
}

export async function listChunksForProtocol(ctx: TenantContext, protocolId: string) {
  return withTenant(ctx, async (tx) =>
    tx.select().from(knowledgeChunks).where(and(eq(knowledgeChunks.hospitalId, ctx.hospitalId), eq(knowledgeChunks.protocolId, protocolId))),
  );
}
