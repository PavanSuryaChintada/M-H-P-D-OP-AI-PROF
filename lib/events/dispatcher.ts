// Doc 16 R1/R4 — the polling dispatcher. Claims one event (SKIP LOCKED),
// runs its handler outside the claiming transaction, then records the
// outcome. An unknown event type or a handler throw both count as a
// failure toward max_attempts rather than crashing the poller — one bad
// event must never stop the rest of the queue from draining.

import { claimNextEvent, markEventDone, markEventFailed } from "../db/repositories/events";
import { EVENT_HANDLERS, type EventType } from "./registry";
import { log, runWithOperationId } from "../obs/logger";

export interface ProcessEventOutcome {
  processed: boolean;
  eventId?: string;
  type?: string;
  error?: string;
}

/** Claims and processes at most one event for this hospital. Returns processed:false when there was nothing claimable. */
export async function processNextEvent(hospitalId: string): Promise<ProcessEventOutcome> {
  return runWithOperationId(async () => {
    const claimed = await claimNextEvent(hospitalId);
    if (!claimed) return { processed: false };

    const handler = EVENT_HANDLERS[claimed.type as EventType];
    try {
      if (!handler) throw new Error(`no handler registered for event type "${claimed.type}"`);
      await handler(hospitalId, claimed.payload as never);
      await markEventDone(hospitalId, claimed.id);
      log("info", "event.processed", { hospitalId, eventId: claimed.id, type: claimed.type });
      return { processed: true, eventId: claimed.id, type: claimed.type };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markEventFailed(hospitalId, claimed.id, claimed.attempts + 1, message);
      log("error", "event.failed", { hospitalId, eventId: claimed.id, type: claimed.type, error: message });
      return { processed: true, eventId: claimed.id, type: claimed.type, error: message };
    }
  });
}

/** Drains up to `limit` claimable events for this hospital in one pass — what a cron/poller tick calls. */
export async function drainEvents(hospitalId: string, limit = 50): Promise<ProcessEventOutcome[]> {
  const outcomes: ProcessEventOutcome[] = [];
  for (let i = 0; i < limit; i++) {
    const outcome = await processNextEvent(hospitalId);
    if (!outcome.processed) break;
    outcomes.push(outcome);
  }
  return outcomes;
}
