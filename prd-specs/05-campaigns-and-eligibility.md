# 05 — Campaign Management & Eligibility

**PRD:** §8, §9 · **Depends on:** 03, 04 · **Feeds:** 06

---

## Scope
Campaign lifecycle and the explainable rule engine that decides who enters the queue.

## Requirements

**R1 — Lifecycle:** `DRAFT → READY → SCHEDULED → RUNNING → PAUSED → COMPLETED`, with `CANCELLED` / `FAILED` terminal. Transitions validated by a state machine, not free-form updates.

**R2 — Configuration:** hospital, name, description, eligibility criteria, clinical follow-up window, calling hours override, priority weight, retry limits, start/end dates, outbound capacity share, escalation config, protocol binding.

**R3 — Pre-activation estimate (PRD §8 explicitly asks):** before `READY → RUNNING`, show eligible patient count, projected attempts (= eligible × expected attempts from retry policy), projected call-hours, and **whether capacity can clear the backlog before the window closes**. If it cannot, warn.

**R4 — Pause semantics:** pausing stops *new* claims. Calls already in `CALLING`/`CONNECTED` run to completion. Resuming **recomputes** eligibility rather than replaying the old task list.

**R5 — Eligibility as an explainable rule engine.** Each rule returns `{passed, reason, evidence}`. Store the full evaluation per patient in `eligibility_evaluations`. The UI must be able to answer "why is patient X not in this campaign?" in one click.

Rules: discharged within window · discharge status valid · not deceased/readmitted · has usable contact · consent/communication preference allows contact · not already completed in this campaign · not in a conflicting active campaign · matches campaign criteria (condition, care setting, risk).

**R6 — Failures are visible:** if eligibility evaluation throws for a patient, that patient goes to `ELIGIBILITY_ERROR` with the error, and appears in a recovery list with a retry action. Never silently excluded (PRD §9 is explicit).

**R7 — Conflict handling:** a patient eligible for two campaigns gets one task per campaign, but the scheduler will not call the same patient twice within a configurable cooldown (doc 06).

## Key deliverables
- [ ] Campaign CRUD + lifecycle state machine with guarded transitions
- [ ] Eligibility rule engine, rules as pure functions, unit tested individually
- [ ] `eligibility_evaluations` persisted with per-rule results
- [ ] "Why not eligible?" drill-down UI
- [ ] Pre-activation workload estimate panel including the feasibility warning
- [ ] Pause/resume implemented per R4, with a test proving active calls finish
- [ ] Recovery list for `ELIGIBILITY_ERROR`
- [ ] Events: `campaign.created|started|paused|resumed|completed`

## Acceptance criteria
- Pausing a RUNNING campaign with 4 active calls: no new claims occur, all 4 complete, dashboard shows 0 pending claims.
- Clicking any excluded patient shows the exact failing rule and its evidence.

## Claude Code prompt
```
Implement campaigns and eligibility per docs 01, 03, 04.

1. Campaign table + lifecycle state machine DRAFT/READY/SCHEDULED/RUNNING/PAUSED/COMPLETED/
   CANCELLED/FAILED. Transitions only via a guarded transition() function that validates the
   move, writes a state transition row, emits an event, and audits.
2. Campaign config: eligibility criteria, follow_up_window_hours, calling hours override,
   priority_weight, max_attempts, start/end, capacity_share, protocol_id.
3. Eligibility rule engine: each rule is a pure function (patient, campaign, ctx) =>
   {ruleId, passed, reason, evidence}. Persist every evaluation to eligibility_evaluations.
4. GET /api/campaigns/:id/eligibility/:patientId returns the full per-rule breakdown.
5. Pre-activation estimate endpoint: eligible count, projected attempts using the retry
   policy, projected call-minutes, and a feasibility flag comparing that against
   max_concurrent_calls x remaining window hours x calling hours. Warn when infeasible.
6. Pause stops new task claims but lets CALLING/CONNECTED tasks finish. Resume re-runs
   eligibility rather than restoring the previous task set.
7. Eligibility exceptions set the task to ELIGIBILITY_ERROR with the message and surface it
   in a recovery list with a retry action. Never drop a patient silently.
8. Tests: each rule in isolation, plus the pause-with-active-calls scenario.
```
