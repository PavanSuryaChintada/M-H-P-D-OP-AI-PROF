# Events, Workflows & Notifications (Doc 16)

## Real near-miss: overwrote an existing `emitEvent`

`lib/db/repositories/events.ts` already existed (doc 05/07 stub: `emitEvent(ctx, input)`, called by `lib/campaigns/transition.ts`, `lib/discharge/ingest.ts`, and the campaigns route). Writing this doc's dispatcher plumbing to that same path via `Write` instead of `Edit` overwrote it with a different signature (`emitEvent(input)`, no `ctx`), which `tsc --noEmit` caught immediately — three unrelated call sites failed with "Expected 1 arguments, but got 2." Recovered the original via `git show HEAD:lib/db/repositories/events.ts` and merged: the original `emitEvent(ctx, input)` signature is kept exactly (only gaining an optional `scheduledFor` for R5), and the new claim/mark/dead-letter functions — which are genuinely new, worker-side code with no prior callers — were added alongside it rather than replacing anything. Same failure mode as a doc 11 near-miss earlier this build; the fix each time is the same: recover with `git show`/`git diff`, never re-guess the original content.

## Scope: one fully-wired chain, not the whole catalogue

R2's event catalogue (16 event types) is declared and typed in `lib/events/registry.ts` so any future doc's `emitEvent` calls type-check against it, but only `escalation.created` and `escalation.timeout_check` have real handlers in this build — R5's chain, the one with required tests. Wiring every other event type's handler (campaign lifecycle, call outcomes, EHR sync, etc.) is real work with no corresponding required test in this doc, and would cost hours the 6-day budget doesn't have. `escalation.timeout_check` itself is an internal implementation detail (schedules R5's "wait" steps) rather than a PRD §20 catalogue entry — documented in the registry, not silently added to the public list.

## R5's chain, and why the "wait" step is a scheduled event, not a timer

`lib/events/handlers/escalation-notifications.ts` implements the exact chain from PRD §20:
`escalation.created` → notify primary reviewer → schedule `escalation.timeout_check` (stage `primary`) at `now + reviewer_timeout_minutes` → if the escalation is still active when that check fires, notify the backup reviewer + schedule a second check (stage `backup`) → if still active, mark `OVERDUE`.

The "wait" is `events.scheduled_for` plus the dispatcher's `scheduled_for <= now()` claim condition — a real column a poller re-reads after a restart, not a `setTimeout` that dies with the process, per R5's explicit requirement.

**Every handler re-reads the escalation's current state before acting** (`getEscalationById`, checked against `ACTIVE_ESCALATION_STATES`). This is what makes two properties true at once, both required by R3:
- **Duplicate delivery is a no-op.** `notifyStage` checks `hasNotificationTagged` (a `subject` prefix like `escalation:<id>:primary`) before creating a notification — reprocessing the same event (or a genuine duplicate) does not double-notify.
- **Out-of-order delivery converges, not corrupts.** If a reviewer acknowledges an escalation through doc 17's (future) UI before a scheduled timeout-check fires, the check reads the now-`ACKNOWLEDGED` state and silently returns — it never assumed the escalation was still open just because that's what it was when the check was *scheduled*.

## Escalation states added

`escalation_state` gained `ACKNOWLEDGED` and `OVERDUE` (additive, alongside doc 13's original `OPEN..CLOSED`). `acknowledgeEscalation`/`markEscalationOverdue` (`lib/db/repositories/escalations.ts`) are deliberately narrow, guarded single-column updates — not a new state-machine module — because doc 13's own comment already assigns "the guarded OPEN→ASSIGNED→...→CLOSED lifecycle" to doc 17. These two functions only ever move a still-active escalation forward; they never touch one that has already resolved, closed, or moved on some other way.

## No email/SMS delivery — honestly, not silently

This build has no real email/webhook provider. `deliverNotification` (`lib/db/repositories/notifications.ts`) marks `IN_APP` `SENT` immediately (R7: "in-app always works") and marks `EMAIL`/`WEBHOOK` `FAILED` with an explicit `"<channel> delivery is not implemented in this build"` error — R7's "allowed to fail visibly" taken literally, rather than fabricating a send that never happened.

## Wired into doc 13

`escalateFromConsensus` (`lib/ai/run-consensus.ts`) calls `startEscalationNotificationChain` right after creating an escalation — idempotent on escalation id, so this is safe even if `escalateFromConsensus` itself is ever retried. There is no `primaryReviewerUserId` yet at escalation-creation time in this build's actual pipeline, because reviewer *assignment* (`escalations.assignedTo`) is doc 17's scope and happens after creation, not at it. The chain still runs and schedules its timeout-check correctly with zero recipients; it simply has no one to notify at the primary stage until doc 17 exists. Tests below exercise the chain with real reviewer ids to prove the mechanism itself, independent of that gap.

**Verified** (`tests/events-and-notifications.test.ts`, 3 tests): a duplicate-delivered event (the same row redelivered, simulating a crash between the handler running and the row being marked done) produces exactly one notification, not two; an acknowledgment that happens before a scheduled timeout-check fires converges without notifying the backup reviewer; an unacknowledged escalation is notified to the backup reviewer and then marked `OVERDUE`.

## What this build does not cover

- Handlers for the rest of the R2 catalogue (campaign/call/task/EHR/notification lifecycle events) — typed and reserved, not implemented.
- Dead-letter admin panel and manual-replay button — the repository functions (`listDeadEvents`, `replayDeadEvent`) exist; the UI is doc 17/18's frontend work, per this build's established split.
- In-app notification centre UI and the hospital config UI for workflow knobs — same split. The underlying config (`notificationPreferences.reviewerTimeoutMinutes`/`channels`/`backupReviewerUserId`) already exists from doc 03; it just has no form yet.
- `callback_reminder_lead_time` (mentioned in R6) — not implemented; no required test depends on it and it isn't part of R5's chain.
