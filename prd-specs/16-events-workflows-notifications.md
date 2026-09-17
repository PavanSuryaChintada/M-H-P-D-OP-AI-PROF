# 16 — Events, Workflows & Notifications

**PRD:** §20 · **Depends on:** 05, 07, 13

---

## Scope
Asynchronous processing, the event bus, and operational workflows like escalation chasing.

## Requirements

**R1 — Event table as the bus.** `events(id, hospital_id, type, payload, idempotency_key, created_at, processed_at, attempts, status, last_error)`. Handlers poll with `FOR UPDATE SKIP LOCKED`, same pattern as the queue. No second infrastructure.

**R2 — Event catalogue:**
`patient.imported` · `discharge.ingested` · `campaign.created|started|paused|resumed|completed` · `task.scheduled|claimed|completed|failed` · `call.started|completed|dropped` · `retry.scheduled` · `callback.requested|missed` · `escalation.created|acknowledged|resolved|timed_out` · `ehr.sync.succeeded|failed` · `notification.sent|failed`

**R3 — Handler contract:** every handler is **idempotent** and keyed on `idempotency_key`. Duplicate delivery is expected, not exceptional. Out-of-order delivery must not corrupt state — handlers read current state rather than assuming the prior event landed.

**R4 — Dead letter:** after `max_attempts`, status `DEAD` with the error, visible in an admin panel with a manual replay action.

**R5 — Escalation notification chain (PRD §20 gives this exact example):**
```
escalation.created
  → notify primary reviewer (in-app + configured channel)
  → wait reviewer_timeout_minutes (from hospital config)
  → if not acknowledged → notify backup reviewer + hospital admin
  → wait again
  → if still not acknowledged → mark escalation OVERDUE, surface on all dashboards
```
Implement as a scheduled follow-up event, not a `setTimeout`. `setTimeout` does not survive a restart.

**R6 — Configurable by non-engineers (PRD §20).** Reviewer timeout, channels, backup reviewer, retry-notification toggle, callback reminder lead time are all in hospital config UI, not in code.

**R7 — Notification delivery is observable.** `notifications(channel, target, status, attempts, sent_at, error)`. In-app always works; email/SMS optional and allowed to fail visibly.

## Key deliverables
- [ ] `events` table + polling dispatcher with SKIP LOCKED
- [ ] Typed event catalogue + handler registry
- [ ] Idempotent handlers with duplicate-delivery tests
- [ ] Dead-letter panel + manual replay
- [ ] Escalation notification chain with timeout escalation
- [ ] In-app notification centre; email optional
- [ ] Config UI for the workflow knobs
- [ ] Tests: duplicate event processed once; out-of-order events converge; unacknowledged escalation reaches backup then OVERDUE

## Claude Code prompt
```
Implement the event bus, workflows and notifications per docs 05, 07 and 13.

1. events table with hospital_id, type, payload jsonb, idempotency_key UNIQUE, status
   (PENDING|PROCESSING|DONE|DEAD), attempts, last_error. A dispatcher polls with
   FOR UPDATE SKIP LOCKED, mirroring the queue claim pattern.
2. Typed event catalogue exactly as listed in this spec, with a handler registry mapping
   type to handler.
3. Every handler is idempotent and reads current state rather than assuming ordering.
   Duplicate delivery must be a no-op.
4. After max attempts an event becomes DEAD. Build an admin dead-letter panel listing them
   with the error and a manual replay button.
5. Escalation notification chain implemented as scheduled follow-up events, never setTimeout:
   notify primary reviewer, wait hospital_config.notification_preferences
   .reviewer_timeout_minutes, if unacknowledged notify backup reviewer and hospital admin,
   wait again, then mark the escalation OVERDUE and surface it on all dashboards.
6. notifications table tracking channel, target, status, attempts, error. In-app notification
   centre component. Email channel optional and allowed to fail visibly.
7. Expose reviewer timeout, channels, backup reviewer and callback reminder lead time in the
   hospital config UI.
8. Tests: duplicate event processed once, out-of-order events converge to correct state,
   unacknowledged escalation reaches backup and then OVERDUE.
```
