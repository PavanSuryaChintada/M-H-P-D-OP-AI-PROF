// Doc 19 R1/R2 — structured JSON logging with a correlation id, propagated
// via AsyncLocalStorage rather than threading an explicit parameter through
// every existing function signature (voice intake, managed-call, the tool
// gateway, EHR routes, the event dispatcher) — that would be a large,
// risky refactor of already-tested code for a 6-day build. ALS gives every
// log emitted anywhere during one request/job/event's execution the same
// operation_id without changing any of those functions' signatures.
//
// R2 — every payload goes through redact() (doc 02) before it is ever
// serialized. This is the one and only place a log line is allowed to be
// produced; there is no raw console.log elsewhere in observability-aware
// code, so there is exactly one place PHI could leak from, and it's this
// file's job to make sure it doesn't.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { redact } from "./redact";

const operationIdStorage = new AsyncLocalStorage<string>();

export function getOperationId(): string | undefined {
  return operationIdStorage.getStore();
}

/** Wrap an API route handler, worker loop iteration, or event handler in this so every log() call inside shares one operation_id. */
export function runWithOperationId<T>(fn: () => T, operationId: string = randomUUID()): T {
  return operationIdStorage.run(operationId, fn);
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  at: string;
  level: LogLevel;
  event: string;
  operationId: string | undefined;
  [key: string]: unknown;
}

/**
 * The only sanctioned way to emit a structured log line. `payload` must
 * never contain a full transcript, free-text clinical content, or any raw
 * PHI field — pass ids (patient_id, call_id, escalation_id), not names,
 * phone numbers, or spoken/typed content, even though redact() also scrubs
 * known PHI keys and email/phone-shaped substrings as a second layer.
 */
export function log(level: LogLevel, event: string, payload: Record<string, unknown> = {}): void {
  const entry: LogEntry = {
    at: new Date().toISOString(),
    level,
    event,
    operationId: getOperationId(),
    ...redact(payload),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
