// Doc 16 R2 — the event catalogue. Every type below is a real domain event
// other docs already emit or will emit; only escalation.created and
// escalation.timeout_check have handlers wired up in this build (R5's
// flagship scenario, and the one with required tests) — the rest of the
// catalogue is typed and reserved so a future doc's emitEvent calls are
// type-checked against it, without this build having to write a handler
// for every one in six days.

export const EVENT_TYPES = [
  "patient.imported",
  "discharge.ingested",
  "campaign.created",
  "campaign.started",
  "campaign.paused",
  "campaign.resumed",
  "campaign.completed",
  "task.scheduled",
  "task.claimed",
  "task.completed",
  "task.failed",
  "call.started",
  "call.completed",
  "call.dropped",
  "retry.scheduled",
  "callback.requested",
  "callback.missed",
  "escalation.created",
  "escalation.acknowledged",
  "escalation.resolved",
  "escalation.timed_out",
  "escalation.timeout_check", // internal — schedules R5's "wait" steps; not itself in PRD §20's list
  "ehr.sync.succeeded",
  "ehr.sync.failed",
  "notification.sent",
  "notification.failed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type EventHandler = (hospitalId: string, payload: never) => Promise<void>;

import { handleEscalationCreated, handleEscalationTimeoutCheck } from "./handlers/escalation-notifications";

export const EVENT_HANDLERS: Partial<Record<EventType, EventHandler>> = {
  "escalation.created": handleEscalationCreated as EventHandler,
  "escalation.timeout_check": handleEscalationTimeoutCheck as EventHandler,
};
