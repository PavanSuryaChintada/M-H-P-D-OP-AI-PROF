// Doc 16 R1/R4 — the polling dispatcher. Claims one event (SKIP LOCKED),
// runs its handler outside the claiming transaction, then records the
// outcome. A handler throw counts as a failure toward max_attempts rather
// than crashing the poller — one bad event must never stop the rest of the
// queue from draining.
//
// A *missing* handler is deliberately NOT the same thing as a failure.
// registry.ts's own comment states the catalogue is intentionally wider
// than the handlers built so far ("typed and reserved... without this
// build having to write a handler for every one in six days") - treating
// that as a failure meant every patient.imported/discharge.ingested/
// campaign.* event (all real, already-emitted types with no handler)
// retried itself into a burst of error logs before finally going DEAD,
// for every single such event ever emitted. Found running this for real
// against a live backlog on Railway: the "error" logs were pure noise,
// nothing was actually broken. An unhandled type is acknowledged and
// cleared immediately instead - there's nothing to usefully retry into
// existence, and this list only grows as future docs add event types
// before their handlers land.

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
    if (!handler) {
      await markEventDone(hospitalId, claimed.id);
      log("debug", "event.no_handler", { hospitalId, eventId: claimed.id, type: claimed.type });
      return { processed: true, eventId: claimed.id, type: claimed.type };
    }

    try {
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
