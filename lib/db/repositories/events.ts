// Doc 16 R1/R3/R4 — the event bus. emitEvent (doc 05/07's original,
// extended here with scheduledFor for R5's "wait" steps) is called with a
// real TenantContext by user/pipeline-triggered code. The claim/mark
// functions below are new (doc 16) and run as worker code (hospital_id GUC
// only) — same SKIP LOCKED pattern as the queue's claimNextTask
// (lib/queue/claim.ts): claim marks PROCESSING and releases the row lock
// at commit, the handler then runs outside any lock, and a second update
// records the outcome.

import { sql, eq } from "drizzle-orm";
import { db } from "../client";
import { withTenant, withHospitalContext, type TenantContext } from "../tenant";
import { events } from "../schema";

export const EVENT_MAX_ATTEMPTS = 5;

export interface EmitEventInput {
  type: string;
  payload?: unknown;
  /** events.idempotency_key is unique — reusing one (e.g. `${sourceMessageId}:${type}`) is how doc 20's consumers detect a duplicate. */
  idempotencyKey: string;
  /** Doc 16 R5 — when this event becomes claimable; defaults to now. A scheduled follow-up event (not setTimeout) is what implements a "wait N minutes" step, since it survives a restart. */
  scheduledFor?: Date;
}

/** Insert-only from the caller's side — event *consumption* is doc 16's dispatcher below. */
export async function emitEvent(ctx: TenantContext, input: EmitEventInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(events)
      .values({
        hospitalId: ctx.hospitalId,
        type: input.type,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        scheduledFor: input.scheduledFor ?? new Date(),
      })
      .onConflictDoNothing({ target: events.idempotencyKey })
      .returning();
    return row ?? null;
  });
}

export async function listEvents(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => tx.select().from(events).where(eq(events.hospitalId, ctx.hospitalId)));
}

export interface ClaimedEvent {
  id: string;
  hospitalId: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/** Claims (at most) one claimable event for this hospital — PENDING, due (scheduled_for <= now()), oldest first. */
export async function claimNextEvent(hospitalId: string): Promise<ClaimedEvent | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.hospital_id', ${hospitalId}, true)`);

    const rows = await tx.execute<{ id: string; hospital_id: string; type: string; payload: unknown; attempts: number }>(sql`
      with next_event as (
        select id from events
         where hospital_id = ${hospitalId}
           and status = 'PENDING'
           and scheduled_for <= now()
         order by created_at asc
         limit 1
         for update skip locked
      )
      update events e
         set status = 'PROCESSING'
        from next_event
       where e.id = next_event.id
      returning e.id, e.hospital_id, e.type, e.payload, e.attempts
    `);
    if (rows.length === 0) return null;
    const row = rows[0];
    return { id: row.id, hospitalId: row.hospital_id, type: row.type, payload: row.payload, attempts: row.attempts };
  });
}

export async function markEventDone(hospitalId: string, eventId: string) {
  return withHospitalContext(hospitalId, async (tx) => {
    await tx.update(events).set({ status: "PROCESSED", processedAt: new Date(), error: null }).where(eq(events.id, eventId));
  });
}

/** Doc 16 R4 — after max_attempts, DEAD with the error; otherwise back to PENDING for the next poll (immediate retry — no backoff needed at this event volume). */
export async function markEventFailed(hospitalId: string, eventId: string, attempts: number, error: string) {
  const status = attempts >= EVENT_MAX_ATTEMPTS ? "DEAD" : "PENDING";
  return withHospitalContext(hospitalId, async (tx) => {
    await tx.update(events).set({ status, attempts, error }).where(eq(events.id, eventId));
  });
}

export async function listDeadEvents(hospitalId: string) {
  return withHospitalContext(hospitalId, async (tx) => tx.select().from(events).where(eq(events.status, "DEAD")));
}

/** Doc 16 R4 — manual replay: back to PENDING, attempts reset, claimable again on the next poll. */
export async function replayDeadEvent(hospitalId: string, eventId: string) {
  return withHospitalContext(hospitalId, async (tx) => {
    const [row] = await tx
      .update(events)
      .set({ status: "PENDING", attempts: 0, error: null, scheduledFor: new Date() })
      .where(eq(events.id, eventId))
      .returning();
    return row ?? null;
  });
}
