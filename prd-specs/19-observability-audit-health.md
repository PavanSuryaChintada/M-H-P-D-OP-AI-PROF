# 19 — Observability, Audit & System Health

**PRD:** §23 · **Depends on:** all

---

## Scope
Making the system's behaviour visible, and proving decisions after the fact.

## Requirements

**R1 — Structured logging** with correlation ids. Every request and every background operation gets an `operation_id` propagated through calls, AI requests, tool invocations, EHR calls and events. This is how you trace one patient's journey across async boundaries.

**R2 — PHI-safe logging (PRD §23).** Run `redact()` (doc 02) on every log payload. Log `patient_id`, never name, phone, DOB or free-text clinical content. Add a test that scans emitted logs for phone-number and name patterns from the seed data.

**R3 — Application metrics:** API latency and error rate, auth failures, background job durations, queue depth, scheduling latency (eligible → claimed), capacity utilisation, retry backlog, stuck tasks, call failures, notification failures, EHR failures.

**R4 — AI observability (PRD §23 enumerates this):** per call — agent, provider, model, prompt version, purpose, latency, retrieval chunk ids, structured-validation outcome, repair attempts, tool calls made, disagreement flag, tokens, estimated cost, failure reason.

**R5 — Audit log** for: campaign create/start/pause, config changes, AI escalation assessments, consensus decisions, human reviews and resolutions, EHR writes, operational overrides, platform-admin patient access. Append-only (doc 01).

**R6 — Health endpoint** `/api/health` returning `HEALTHY | DEGRADED | UNAVAILABLE` plus components:
```json
{ "status":"DEGRADED",
  "components": {
    "database":"HEALTHY", "worker":"HEALTHY",
    "ai_provider_primary":"HEALTHY", "ai_provider_secondary":"DEGRADED",
    "ehr":"HEALTHY", "queue":"HEALTHY" },
  "queue": { "active_calls":7, "capacity":10, "pending":142,
             "oldest_pending_minutes":23, "cutoff_risk":4,
             "failed":2, "stuck_workers":0 } }
```
The `queue` block is exactly what PRD §23 asks for. Put it on screen too.

**R7 — Worker heartbeats** in a `workers` table; missing heartbeat > 90s → `stuck_workers` increments and the reaper acts (doc 07).

## Key deliverables
- [ ] `lib/obs/logger.ts` with correlation ids + redaction
- [ ] Metrics collection + an internal `/admin/metrics` view
- [ ] `ai_usage` fully populated per R4
- [ ] Append-only audit log + an audit viewer with filters
- [ ] `/api/health` per R6 + a system health page
- [ ] Worker heartbeat table
- [ ] Test: no seed-data phone number or patient name appears in any log output

## Claude Code prompt
```
Implement observability, audit and health per all prior docs.

1. lib/obs/logger.ts: structured JSON logging with an operation_id correlation id propagated
   through API handlers, workers, AI calls, tool invocations, EHR calls and event handlers.
   Every payload passes through redact() before emission.
2. Metrics for: API latency and errors, auth failures, job durations, queue depth,
   scheduling latency from eligible to claimed, capacity utilisation, retry backlog, stuck
   tasks, call failures, notification failures, EHR failures. Expose at /admin/metrics.
3. Ensure ai_usage records agent, provider, model, prompt_version, purpose, latency,
   retrieval chunk ids, validation outcome, repair attempts, tool calls, disagreement flag,
   tokens, estimated cost and failure reason.
4. Audit viewer over the append-only audit_log with filters for actor, hospital, action type
   and date range.
5. GET /api/health returning overall HEALTHY/DEGRADED/UNAVAILABLE, per-component status, and
   the queue block with active_calls, capacity, pending, oldest_pending_minutes,
   cutoff_risk, failed and stuck_workers. Render it as a system health page.
6. workers table with heartbeats; a worker silent for more than 90 seconds counts as stuck.
7. Write a test that runs a seeded call end to end, captures all log output, and asserts no
   seed patient name or phone number appears anywhere in it.
```
