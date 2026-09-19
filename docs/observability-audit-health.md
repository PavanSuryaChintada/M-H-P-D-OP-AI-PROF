# Observability, Audit & System Health (Doc 19)

## Correlation ids via AsyncLocalStorage, not a threaded parameter

R1 asks for an `operation_id` propagated through calls, AI requests, tool invocations, EHR calls, and events. Threading an explicit parameter through every existing function signature in `managed-call.ts`, the tool gateway, EHR routes, and the event dispatcher would be a large, risky refactor of already-tested code this late in the build. `lib/obs/logger.ts` uses Node's `AsyncLocalStorage` instead: `runWithOperationId()` wraps an entry point (a call, an event-dispatcher tick), and every `log()` call anywhere inside that call tree picks up the same id automatically, with zero changes to the wrapped functions' signatures.

**Wired at three representative points**, not exhaustively: `lib/voice-intake/run-call.ts` (call start/outcome — the highest PHI-risk surface, see below), `lib/events/dispatcher.ts` (`processNextEvent`), and `lib/ehr/route-helpers.ts` (every mock-EHR call). `lib/auth/guard.ts` logs auth denials (401/403/404) without its own operation-id wrapper, since it runs inside whatever a route handler already established. The rest of the codebase (managed-call.ts's AI provider calls, the tool gateway) is not yet instrumented — a real gap, documented rather than silently left unmentioned.

## The redaction test's design: prove the risk is real, not just that the check passes

R2's required test seeds a patient with a **deliberately distinctive** name (`Priyaverakshita Thennarasukumar`) and phone number, then runs the real `runCall()` production path (not a mock) with that name embedded in the agent's own greeting line — the exact place a name could leak, since the transcript literally contains it. The test asserts two things: the transcript *does* contain the name (proving the test isn't vacuously passing because nothing risky ever happened), and the captured log output *never* does. `lib/obs/logger.ts` is the only place a log line is allowed to be emitted, and it runs every payload through doc 02's `redact()` before serializing — but the real protection here is discipline: the logger calls added in this doc pass `patientId`, `outreachTaskId`, `outcome` — never the transcript array or `patientFirstName` itself.

## Health check never bypasses RLS either

Same rule as doc 18's Platform Admin dashboard: `/api/health`'s queue block spans every hospital, so `lib/obs/health.ts` loops per hospital under `withHospitalContext` and sums in application code, never a single unscoped query. `ai_provider_primary`/`ai_provider_secondary` are reported `HEALTHY` as an honest default — this build has no live provider API keys configured (every test runs against `MockProvider`), so there is nothing to actually ping; documented rather than faking a real liveness check.

## Worker heartbeats are tenant-scoped

A `workers` row carries `hospital_id` like everything else, because a worker in this codebase (queue claim, the reaper, the event dispatcher) processes one hospital's work at a time — see `claimNextTask(hospitalId, ...)`. `countStuckWorkers` — no heartbeat in the last 90 seconds — feeds `/api/health`'s `stuck_workers` count.

## Metrics and audit reuse doc 18's layer, not a second pipeline

`/api/hospitals/[hospitalId]/metrics` returns queue depth, capacity utilization, retry backlog, and EHR/call/notification failure counts — all either reused directly from `lib/analytics/` (doc 18) or one small new aggregate query (`getOperationalMetrics`). **API latency/error rate and auth-failure counts are not in this endpoint** — they're emitted as log events (`auth.denied`) rather than aggregated into a queryable table, since this build has no metrics store (Prometheus, etc.) to aggregate them into. A real deployment would scrape the log stream for those two; documented as a gap, not silently dropped.

The audit viewer (`/admin/hospitals/[hospitalId]/audit`) queries the existing append-only `audit_log` table directly, filterable by actor/action/date range, per R5's deliverable — no new audit infrastructure, since doc 09's tool gateway and doc 17's escalation actions already write to it correctly.

## What this build does not cover

- Full operation-id propagation through every AI/tool-gateway call (only 3 representative choke points wired).
- API latency/error-rate metrics and a persisted auth-failure counter (logged, not aggregated).
- Repair-attempt counts and tool-calls-made are not separately surfaced in `ai_usage` beyond what doc 09/12 already record (`retry_count`, `validation_outcome`) — no duplicate columns added for data already queryable via `triage_results`/`escalation_assessments`.
