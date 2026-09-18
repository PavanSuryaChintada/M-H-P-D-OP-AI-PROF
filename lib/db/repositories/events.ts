import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { events } from "../schema";

export interface EmitEventInput {
  type: string;
  payload?: unknown;
  /** events.idempotency_key is unique — reusing one (e.g. `${sourceMessageId}:${type}`) is how doc 20's consumers detect a duplicate. */
  idempotencyKey: string;
}

/** Insert-only — event *consumption* (doc 16 workflows) isn't built yet, this just lands the row for later docs to read. */
export async function emitEvent(ctx: TenantContext, input: EmitEventInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(events)
      .values({ hospitalId: ctx.hospitalId, type: input.type, payload: input.payload, idempotencyKey: input.idempotencyKey })
      .onConflictDoNothing({ target: events.idempotencyKey })
      .returning();
    return row ?? null;
  });
}

export async function listEvents(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => tx.select().from(events).where(eq(events.hospitalId, ctx.hospitalId)));
}
