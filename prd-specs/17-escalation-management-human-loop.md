# 17 — Escalation Management & Human-in-the-Loop

**PRD:** §21 · **Depends on:** 13, 16

---

## Scope
The clinical reviewer's workflow. This is where the AI hands control to a human, and the grader will look closely at whether that handover is complete.

## Requirements

**R1 — Lifecycle:** `OPEN → ASSIGNED → IN_REVIEW → WAITING_FOR_INFORMATION → RESOLVED → CLOSED`. Guarded transitions, transition rows, audit.

**R2 — Escalation record:** patient, hospital, campaign, call, trigger, clinical indicators, all three triage results, consensus result, priority, created_at, assigned_reviewer, status, resolution, resolution_notes, resolved_at, time_to_acknowledge, time_to_resolve.

**R3 — The review screen must contain everything needed to decide** without leaving the page:
- Patient summary: conditions, medications, discharge date and instructions, risk indicators
- Full transcript, with the indicator-triggering turns highlighted
- The three assessments side by side, with the firing consensus rule labelled
- Protocol evidence, each indicator expandable to its source excerpt
- Previous outreach history for this patient
- Action bar: acknowledge · assign/reassign · request more info · resolve with outcome · create follow-up task

**R4 — Resolution outcomes** (structured, not free text alone): `contacted_patient` · `advised_self_care` · `booked_appointment` · `referred_to_emergency` · `no_action_needed_false_positive` · `unable_to_contact` · `other`. Plus mandatory notes.

**`no_action_needed_false_positive` is important** — it is how you measure your own false-positive rate in production, and it feeds doc 21's report. Say so.

**R5 — Queue view for reviewers:** sorted by priority then age, with OVERDUE pinned to the top, filterable by hospital/campaign/status.

**R6 — Everything auditable:** every human action, override and resolution writes an audit row with actor, timestamp, before/after.

**R7 — SLA metrics:** time-to-acknowledge and time-to-resolve computed and surfaced (feeds doc 18).

## Key deliverables
- [ ] Escalation lifecycle state machine
- [ ] Reviewer work queue with priority/age/OVERDUE ordering
- [ ] Full review screen per R3
- [ ] Structured resolution capture
- [ ] Assignment and reassignment
- [ ] Audit trail on all human actions
- [ ] SLA metric computation
- [ ] Tests: role enforcement (only CLINICAL_REVIEWER resolves), lifecycle guards, audit completeness

## Acceptance criteria
- A reviewer can go from work queue to informed resolution without opening another page or asking a question the UI cannot answer.
- Resolving an escalation as a false positive is recorded in a way doc 21 can aggregate.

## Claude Code prompt
```
Implement escalation management and the human review workflow per docs 13 and 16.

1. Escalation lifecycle OPEN/ASSIGNED/IN_REVIEW/WAITING_FOR_INFORMATION/RESOLVED/CLOSED with
   guarded transitions, transition rows, events and audit entries.
2. Reviewer work queue: sorted by priority then age, OVERDUE pinned top, filters for
   hospital, campaign and status. Only CLINICAL_REVIEWER and HOSPITAL_ADMIN may open it.
3. Review screen containing, on one page: patient summary with conditions, medications,
   discharge date and instructions; full transcript with indicator-triggering turns
   highlighted; the three assessments side by side with the firing consensus rule labelled;
   expandable protocol evidence per indicator; previous outreach history; and an action bar
   for acknowledge, assign, reassign, request information, resolve and create follow-up task.
4. Structured resolution outcomes: contacted_patient, advised_self_care, booked_appointment,
   referred_to_emergency, no_action_needed_false_positive, unable_to_contact, other, plus
   mandatory notes.
5. Compute and store time_to_acknowledge and time_to_resolve on the escalation.
6. Audit every human action with actor, timestamp and before/after state.
7. Tests: only CLINICAL_REVIEWER can resolve; illegal lifecycle transitions rejected; every
   action produces an audit row.
```
