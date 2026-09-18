// Doc 09/11 — protocols. Doc 09 needs enough here to back the
// search_protocol tool; real semantic chunk retrieval over
// knowledge_chunks.embedding (pgvector) is doc 11's scope. This does a
// plain keyword match over protocols.content as the doc 09-era
// implementation — doc 11 replaces the query, not the tool's contract.

import { and, eq, ilike, or } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { protocols } from "../schema";

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
