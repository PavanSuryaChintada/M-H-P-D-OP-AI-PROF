// Doc 09/11 — protocols. Doc 09 needs enough here to back the
// search_protocol tool; real semantic chunk retrieval over
// knowledge_chunks.embedding (pgvector) is doc 11's scope. This does a
// plain keyword match over protocols.content as the doc 09-era
// implementation — doc 11 replaces the query, not the tool's contract.

import { and, eq, ilike, or } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { protocols } from "../schema";
import { StructuredProtocolSchema, type StructuredProtocol } from "../../protocols/schema";
import type { RedFlag } from "../../ai/assessors/rule-engine";

export interface CreateProtocolInput {
  title: string;
  category?: string;
  content: string;
  structuredContent: StructuredProtocol;
}

/** Doc 11 R1 — validates the structured content with zod before it's ever written; a protocol that doesn't match the shape the rule engine (doc 13) and intake (doc 10) depend on is rejected, not stored malformed. */
export async function createProtocol(ctx: TenantContext, input: CreateProtocolInput) {
  const structuredContent = StructuredProtocolSchema.parse(input.structuredContent);
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(protocols)
      .values({
        hospitalId: ctx.hospitalId,
        title: input.title,
        category: input.category,
        content: input.content,
        version: structuredContent.version,
        structuredContent,
        specialty: structuredContent.specialty,
        effectiveFrom: new Date(structuredContent.effectiveFrom),
      })
      .returning();
    return row;
  });
}

/** Doc 13's rule engine takes RedFlag[] as a plain argument (lib/ai/assessors/rule-engine.ts) rather than loading them itself — this is the function that supplies real data, reshaping the protocol's structured red_flags into the chunk-referencing shape the rule engine expects. */
export async function getRedFlagsForProtocol(ctx: TenantContext, protocolId: string): Promise<RedFlag[]> {
  const protocol = await getProtocolById(ctx, protocolId);
  if (!protocol?.structuredContent) return [];
  const structured = protocol.structuredContent as StructuredProtocol;
  return structured.redFlags.map((flag) => ({
    id: flag.id,
    description: flag.description,
    triggerKeywords: flag.triggerKeywords,
    severity: flag.severity,
    protocolId: protocol.id,
    protocolVersion: String(protocol.version),
    chunkId: `red_flag:${flag.id}`, // resolved to a real knowledge_chunks row by lib/ai/retrieval.ts's getTriageContext
  }));
}

export async function getProtocolById(ctx: TenantContext, protocolId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(protocols).where(eq(protocols.id, protocolId));
    return row ?? null;
  });
}

export async function listProtocols(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => tx.select().from(protocols).where(eq(protocols.hospitalId, ctx.hospitalId)));
}

/** Doc 03's readiness checklist needs "≥1 protocol" (R5). */
export async function countProtocols(ctx: TenantContext): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select({ id: protocols.id }).from(protocols).where(eq(protocols.hospitalId, ctx.hospitalId));
    return rows.length;
  });
}

/** Doc 09-era search_protocol backing: plain keyword match. Doc 11 upgrades this to pgvector similarity search over knowledge_chunks without changing the tool's args/result shape. */
export async function searchProtocolsByKeyword(ctx: TenantContext, query: string, category?: string) {
  return withTenant(ctx, async (tx) => {
    const pattern = `%${query}%`;
    return tx
      .select()
      .from(protocols)
      .where(
        and(
          eq(protocols.hospitalId, ctx.hospitalId),
          or(ilike(protocols.title, pattern), ilike(protocols.content, pattern)),
          category ? eq(protocols.category, category) : undefined,
        ),
      )
      .limit(5);
  });
}
