import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { protocols } from "../schema";

// Minimal — doc 03's readiness checklist needs "≥1 protocol" (R5). Full
// protocol management (upload, versioning, retrieval) is doc 11's scope.

export async function countProtocols(ctx: TenantContext): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({ id: protocols.id })
      .from(protocols)
      .where(eq(protocols.hospitalId, ctx.hospitalId));
    return rows.length;
  });
}
