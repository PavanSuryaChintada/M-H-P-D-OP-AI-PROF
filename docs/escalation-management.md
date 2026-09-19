# Escalation Management & Human-in-the-Loop (Doc 17)

## Reconciling R1's diagram with doc 16's own additions

R1's lifecycle diagram is the simple chain `OPEN → ASSIGNED → IN_REVIEW → WAITING_FOR_INFORMATION → RESOLVED → CLOSED`. Doc 16 (built first, since it depends on 13 not 17) already added `ACKNOWLEDGED` and `OVERDUE` to `escalation_state` for its own notification chain. These aren't a conflict: R3's own action bar lists "acknowledge" as a distinct action from "assign," so `ACKNOWLEDGED` is a real part of this lifecycle — just not drawn in R1's simplified diagram. `OVERDUE` is set exclusively by doc 16's timeout chain, never by a guarded transition here, but a reviewer must still be able to act on an overdue escalation. The actual guarded graph (`lib/escalations/lifecycle.ts`) is:

```
OPEN → ACKNOWLEDGED, ASSIGNED, OVERDUE
ACKNOWLEDGED → ASSIGNED, OVERDUE
ASSIGNED → IN_REVIEW, RESOLVED, OVERDUE
IN_REVIEW → WAITING_FOR_INFORMATION, RESOLVED, OVERDUE
WAITING_FOR_INFORMATION → IN_REVIEW, RESOLVED, OVERDUE
OVERDUE → ASSIGNED, IN_REVIEW, RESOLVED
RESOLVED → CLOSED
CLOSED → (terminal)
```

R1's own chain is a valid path through this graph; the extra edges are what make `ACKNOWLEDGED`/`OVERDUE` escapable instead of dead ends.

## One transition function, shared by both docs

`transitionEscalationState` (`lib/db/repositories/escalations.ts`) is the only place `escalations.state` is ever written after creation — validates the transition, writes the row, logs an `escalation_state_transitions` row, and (usually) writes an audit entry with before/after state, mirroring doc 07's outreach-task state machine pattern exactly. Doc 16's `acknowledgeEscalation`/`markEscalationOverdue` were refactored to call through it too, so they gained transition-row logging for free.

**Real bug, same shape as doc 14/15's**: routing doc 16's automated transitions through the same audit-logging path broke immediately — `writeAuditLog` requires a real `users.id` for `actor_user_id`, but doc 16's timeout chain runs under a synthetic system actor with no real user row. Caught by re-running doc 16's own test suite after the refactor (not by inspection). Fixed with a `skipAudit` flag on `transitionEscalationState`, used only by the two automated transitions — which is also the more spec-correct reading of R6 anyway ("every **human** action... writes an audit row"): an automated timeout is not a human action, so it shouldn't produce a "who did this" audit entry with a fabricated actor.

## SLA fields are snapshotted, not computed on read

`acknowledged_at`/`time_to_acknowledge_seconds` are stamped on the first move out of `OPEN` (`ACKNOWLEDGED` or `ASSIGNED`, whichever happens first — both mean a human or the system noticed it); `resolved_at`/`time_to_resolve_seconds` on the move into `RESOLVED`. Stored rather than computed on every read so doc 18's dashboards can query them directly without repeating the same subtraction in every aggregate query.

## Permissions: `escalation:view`/`escalation:assign` are narrower than `queue:view`

R5 says "only CLINICAL_REVIEWER and HOSPITAL_ADMIN may open [the queue]" — narrower than the existing `queue:view` action (which also grants CAMPAIGN_MANAGER, for the call-dispatch queue doc 06 built). Added two new actions: `escalation:view` (queue + review screen read) and `escalation:assign` (acknowledge/assign/reassign/request-info/create-followup — lower stakes than resolving, but still not open to CAMPAIGN_MANAGER). `escalation:resolve` is untouched from doc 13/16 — CLINICAL_REVIEWER only, exactly matching R7's required test, including that HOSPITAL_ADMIN can assign but still cannot resolve.

## One action endpoint, not six

`POST /api/hospitals/[hospitalId]/escalations/[escalationId]` dispatches on a `{action: ...}` body (`acknowledge`/`assign`/`reassign`/`move_to_review`/`request_info`/`resolve`/`close`/`create_followup`) rather than one route per action — the permission check differs only for `resolve` (checked before dispatch), and an illegal-transition attempt on any action returns 409 with the specific from→to error, not a generic 500.

## Frontend (first real UI in this build)

`/admin/hospitals/[hospitalId]/escalations` — the reviewer queue (R5): status filter, OVERDUE rows visually flagged, sorted server-side (OVERDUE first, then priority, then age). `/admin/hospitals/[hospitalId]/escalations/[escalationId]` — the full review screen (R3), one page, one round trip (`getEscalationReviewData`): patient summary (conditions, medications, discharge date/instructions, risk level), full transcript with indicator-triggering turns highlighted (cross-referencing each assessment's `evidence.turn_index`), all three assessments side by side with the firing consensus rule labelled and each indicator's protocol evidence in a `<details>` expander, previous outreach history, and the full action bar. Built in the same minimal inline-style convention as the existing `/admin/hospitals/[hospitalId]/patients` pages (no design system exists yet in this codebase) — functional, not polished, consistent with this build's time budget.

**Verified**: `npx tsc --noEmit` and `npx next build` both clean (catches the server/client component and JSX issues a type-check alone can miss). Manual interactive browser testing was not performed — this environment has no browser tool — so the pages are verified to compile and their data contracts are verified against the same repository functions the integration tests exercise, but not click-tested end-to-end.

**Verified** (`tests/escalation-lifecycle.test.ts`, 6 tests; `tests/rbac.test.ts`, 5 new tests): illegal transitions rejected (including out of a terminal state); a full valid path (assign → in_review → resolve → close) computes `time_to_acknowledge`/`time_to_resolve`; `no_action_needed_false_positive` is recorded as its own distinct outcome, never collapsed into `other`; every human action writes an audit row with the exact expected sequence and before/after state; the reviewer queue orders OVERDUE above higher priority, and priority above age; CAMPAIGN_MANAGER is blocked from both `escalation:view` and `escalation:assign`; HOSPITAL_ADMIN can assign but not resolve.

## What this build does not cover

- Dead-letter admin panel, in-app notification centre, hospital config UI for workflow knobs — doc 16's own deferred list, still deferred.
- Automated tests clicking through the actual rendered UI (no browser tool in this environment) — covered instead by build-compiles-cleanly + the same repository-level integration tests the API routes call.
- A dedicated "reviewer picks from a list of hospital staff" assignment UI — `assign` defaults to self-assign (the signed-in reviewer); `reassign` accepts an explicit `reviewerUserId` in its request body but the review screen has no reviewer picker widget yet.
