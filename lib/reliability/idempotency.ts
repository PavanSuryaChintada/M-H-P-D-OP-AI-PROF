// Doc 20 R1 — generic idempotency helper for operations without an
// equivalent DB-level guarantee already (see schema.ts's comment on
// idempotencyKeys for which operations that is). Replay returns the
// original stored result without re-executing fn.

import { eq, and } from "drizzle-orm";
import { withTenant, type TenantContext } from "../db/tenant";
import { idempotencyKeys } from "../db/schema";

export async function withIdempotency<T>(ctx: TenantContext, key: string, operation: string, fn: () => Promise<T>): Promise<T> {
  return withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.hospitalId, ctx.hospitalId), eq(idempotencyKeys.key, key)));
    if (existing) return existing.result as T;

    const result = await fn();
    await tx
      .insert(idempotencyKeys)
      .values({ hospitalId: ctx.hospitalId, key, operation, result: result as unknown })
      .onConflictDoNothing({ target: [idempotencyKeys.hospitalId, idempotencyKeys.key] });
    return result;
  });
}
