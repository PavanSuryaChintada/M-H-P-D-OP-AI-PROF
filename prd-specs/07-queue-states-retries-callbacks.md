# 07 — Queue States, Retries, Callbacks & Failure Recovery

**PRD:** §11 · **Depends on:** 06 · **Critical**

---

## Scope
The task state machine and every path out of a call attempt.

---

## 1. State machine

```
PENDING ──────► SCHEDULED ──► CALLING ──► CONNECTED ──► COMPLETED
   │                             │            │
   │                             │            ├──► ESCALATED
   │                             │            └──► CALLBACK_SCHEDULED
   │                             │
   │                             ├──► NO_ANSWER ─┐
   │                             ├──► BUSY ──────┤
   │                             ├──► VOICEMAIL ─┼──► RETRY_SCHEDULED ──► SCHEDULED
   │                             ├──► DROPPED ───┘
   │                             ├──► INVALID_NUMBER ──► MANUAL_FOLLOW_UP
   │                             ├──► DECLINED ────────► COMPLETED (no retry)
   │                             └──► FAILED (technical) ──► RETRY_SCHEDULED | FAILED
   │
   └──► ELIGIBILITY_ERROR
Max attempts reached, or window expired ──► MANUAL_FOLLOW_UP
```

Every transition writes `outreach_task_state_transitions(from, to, reason, actor, at)`.
Illegal transitions throw. Do not allow arbitrary `UPDATE state`.

---

## 2. Outcome → policy table

Make this a literal table in code, `lib/queue/outcome-policy.ts`:

| Outcome | Retry? | Backoff | Preserves context | Notes |
|---|---|---|---|---|
| `COMPLETED` | no | – | – | terminal |
| `NO_ANSWER` | yes | standard | no | |
| `BUSY` | yes | **short** (10 min) | no | line was live — person is there |
| `VOICEMAIL` | yes | standard, **max 2** | no | leave message once, then manual |
| `DROPPED` | yes | **5 min** | **yes** | resume conversation, do not restart |
| `INVALID_NUMBER` | **no** | – | – | → `MANUAL_FOLLOW_UP` immediately |
| `DECLINED` | **no** | – | – | patient refused; respect it, log it |
| `NETWORK_FAILURE` | yes | standard | yes | technical, not patient-caused |
| `PROVIDER_ERROR` | yes | standard, **does not consume an attempt** | yes | our fault, not the patient's |
| `CALLBACK_REQUESTED` | pinned | — | yes | → `CALLBACK_SCHEDULED` at requested time |

**Design point to state in the doc:** provider errors must not consume the patient's retry budget. A patient should never be dropped to manual follow-up because *our* AI provider was down.

---

## 3. Backoff

```
backoff_minutes = base[attempt] * jitter
base = [15, 45, 120, 240]        // configurable per hospital
jitter = 1 + random(-0.2, +0.2)  // prevents thundering herd on the next tick
```

Then clamp:
1. If `next_attempt` falls outside calling hours → move to the next calling-hours opening.
2. If `next_attempt` falls outside the patient's stated preference window → move to the next preferred window.
3. If `next_attempt` > window end → do not schedule; go straight to `MANUAL_FOLLOW_UP` with reason `WINDOW_WOULD_EXPIRE`. **Do not schedule a call that can never legally happen.**

---

## 4. Callbacks (PRD §11 calls this out specifically)

- Captured during the call as a structured tool call (doc 12): `schedule_callback({requested_at, timezone, note})`.
- Task → `CALLBACK_SCHEDULED` with `scheduled_for = requested_at`.
- Enters **Tier 0** at claim time — time-pinned, not re-scored.
- If the requested time is outside calling hours or past the window end, the agent must offer the nearest valid alternative **during the call**, not silently reschedule afterwards.
- A missed callback (worker down, capacity full at that minute) is retried within a 30-min grace, then escalates to manual with reason `CALLBACK_MISSED`.

---

## 5. Dropped-call context preservation

`calls.partial_state jsonb` holds: questions already answered, symptoms already reported, protocol step index, and the last agent utterance. On retry the Voice Intake Agent receives this and opens with a resumption line ("we were disconnected — you'd mentioned X, can we carry on from there"). Doc 10 owns the prompt.

**Never restart a clinical questionnaire from zero after a drop.** PRD §11 is explicit.

---

## 6. Worker failure recovery

- Every claimed task carries `lease_expires_at`. The worker heartbeats every 30s, extending the lease.
- A **reaper job** runs every 30s:
  ```sql
  UPDATE outreach_tasks SET state='RETRY_SCHEDULED', worker_id=NULL,
         scheduled_for = now() + interval '2 minutes',
         last_error = 'lease_expired'
   WHERE state IN ('CALLING','CONNECTED') AND lease_expires_at < now()
  RETURNING hospital_id;
  -- then decrement hospital_capacity.active_count for each, same transaction
  ```
- A crashed worker must never permanently hold capacity. This is called out in PRD §11 and §24.
- Reaped tasks do **not** consume an attempt (it was our failure).

---

## 7. Duplicate prevention

- `calls` has `UNIQUE (outreach_task_id, attempt_number)`.
- Every side effect (EHR write, notification, escalation) carries an idempotency key `{task_id}:{attempt}:{action}` (doc 20).

---

## Key deliverables
- [ ] `lib/queue/state-machine.ts` — declared transitions, `transition()` guard, illegal moves throw
- [ ] `lib/queue/outcome-policy.ts` — the table above as data
- [ ] `lib/queue/backoff.ts` — backoff + calling-hours + preference + window clamping
- [ ] Callback scheduling path end-to-end, including the "requested time is invalid" branch
- [ ] `partial_state` capture and resumption
- [ ] `lib/queue/reaper.ts` + heartbeat
- [ ] Max-attempts → `MANUAL_FOLLOW_UP` + notification (doc 16)
- [ ] `docs/queue-design.md` §states, §retries, §callbacks, §recovery
- [ ] Tests: every outcome path; reaper releases capacity; illegal transition throws; dropped-call resume keeps context; window-expiry does not schedule an impossible call

## Acceptance criteria
- Kill a worker mid-call (`SIGKILL`). Within 60s the task is back to `RETRY_SCHEDULED`, capacity is released, and attempts did **not** increment.
- A patient requesting callback at 03:00 is offered an alternative in-conversation, not silently moved.

## Claude Code prompt
```
Implement queue states, retries, callbacks and failure recovery per doc 06.

1. lib/queue/state-machine.ts: declare all legal transitions for PENDING, SCHEDULED, CALLING,
   CONNECTED, COMPLETED, NO_ANSWER, BUSY, VOICEMAIL, DROPPED, INVALID_NUMBER, DECLINED,
   RETRY_SCHEDULED, CALLBACK_SCHEDULED, ESCALATED, MANUAL_FOLLOW_UP, FAILED,
   ELIGIBILITY_ERROR. transition(task, to, reason, actor) validates, writes a transition row,
   emits an event, audits. Illegal transitions throw.
2. lib/queue/outcome-policy.ts encoding the outcome table in this spec exactly, including
   BUSY short backoff, VOICEMAIL max 2, DROPPED 5min with context, INVALID_NUMBER and
   DECLINED no retry, and PROVIDER_ERROR not consuming an attempt.
3. lib/queue/backoff.ts: base [15,45,120,240] minutes with +/-20% jitter, then clamp forward
   to the next calling-hours window, then to the patient's preferred window, and if the
   result exceeds the clinical window end, transition to MANUAL_FOLLOW_UP with reason
   WINDOW_WOULD_EXPIRE instead of scheduling.
4. Callback path: schedule_callback tool sets CALLBACK_SCHEDULED with scheduled_for =
   requested time, which the claim query treats as Tier 0. If the requested time is invalid,
   the agent must offer an alternative during the call. Missed callbacks get a 30 minute
   grace then MANUAL_FOLLOW_UP with reason CALLBACK_MISSED.
5. calls.partial_state jsonb capturing answered questions, reported symptoms, protocol step
   index and last agent utterance. On retry after DROPPED, pass it to the agent for resumption.
6. lib/queue/reaper.ts running every 30s: find CALLING/CONNECTED tasks with expired leases,
   reset them to RETRY_SCHEDULED, decrement hospital_capacity.active_count in the same
   transaction, and do NOT increment attempts. Worker heartbeats extend the lease every 30s.
7. UNIQUE (outreach_task_id, attempt_number) on calls.
8. Tests for every outcome path, the SIGKILL recovery scenario, illegal transitions, dropped
   call context resumption, and window-expiry refusing to schedule.
```
