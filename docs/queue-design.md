# Queue Design — Docs 06/07/08

This document covers the priority algorithm and concurrency control (doc 06). It will be extended with states/retries/callbacks (doc 07) and the mandatory simulation (doc 08).

## Priority — tiered first, scored second

Selection is **tiered first, scored second**. Some conditions must dominate any score:

```
TIER 0 — TIME-PINNED    Callbacks due within ±10 min of their requested time.
TIER 1 — CUTOFF RISK    remaining_ratio < 0.20 OR absolute time remaining < 2h.
TIER 2 — SCORED POOL    Everything else, ordered by priority_score desc, created_at asc.
```

A patient who asked to be called at 15:00 is called at 15:00, not "when their score wins." A task about to lose its entire clinical window outranks any score, because that loss is unrecoverable while a delayed call is not.

### The score (Tier 2 only)

```
priority_score = 0.40·deadline_pressure + 0.30·clinical_risk + 0.15·campaign_weight + 0.10·wait_age − 0.05·attempt_penalty
```

| Term | Definition | Range |
|---|---|---|
| `deadline_pressure` | `1 − (time_remaining / total_window)`, clamped | 0–1 |
| `clinical_risk` | `{LOW:0.1, MEDIUM:0.4, HIGH:0.7, CRITICAL:1.0}` | 0–1 |
| `campaign_weight` | campaign `priority` normalised across the hospital's *running* campaigns | 0–1 |
| `wait_age` | `min(hours_since_created / 24, 1)` | 0–1 |
| `attempt_penalty` | `min(attempts / max_attempts, 1)` | 0–1 |

**Why these weights.** Deadline pressure dominates because a missed clinical window is unrecoverable; a delayed call is recoverable. Clinical risk is second — a high-risk patient's call carries more expected value. Campaign weight is an operator lever, deliberately weaker than either clinical factor, so business priority can never outrank patient safety. Wait-age guarantees monotonic progress toward selection, so nothing starves purely by being deprioritized every tick. Attempt penalty is subtractive and small by design — it nudges ordering (repeatedly-unreachable patients yield to reachable ones), it never excludes a patient outright.

### Worked example (reproduced exactly in `tests/queue-priority.test.ts`)

| Patient | Risk | Window left/total | Attempts | Tier | Score |
|---|---|---|---|---|---|
| A | CRITICAL | 20h/24h | 0 | 2 | 0.4967 |
| B | LOW | 1.5h/48h | 1 | **1** (< 2h absolute) | — |
| C | HIGH | 6h/24h | 0 | 2 | 0.67 |

Selection order: **B → C → A**. B wins on tier alone. Between A and C (both Tier 2), C outranks A — a high-risk patient with 6 of 24 hours left beats a critical-risk patient with 20 of 24 hours left, because deadline pressure (0.75 vs 0.17) dominates the formula. This is intentional: A still has time to be reached later; B and C do not.

### Fairness across competing campaigns

Each tick, every *running* campaign gets a claim ceiling:

```
campaign_ceiling = max(1, floor(free_capacity · campaign_weight / Σ weights))
```

The `max(1, …)` floor means a high-weight campaign can never fully starve a low-weight one — every running campaign gets at least one slot per tick it has claimable work. Combined with `wait_age` (which keeps pushing a long-waiting task's score up regardless of which campaign it's in), starvation is prevented by two independent mechanisms, not one.

### Patient-level cooldown

A patient eligible for two campaigns (doc 05 R7) is never called twice within `patient_call_cooldown_minutes` (default 120). Enforced at claim time by a `NOT EXISTS` clause against recent `calls` rows for that `patient_id` — not by any application-level check, so it holds even under concurrent claims from different campaigns.

## Concurrency control

### Mechanism

One `hospital_capacity` row per hospital: `(hospital_id, max_concurrent_calls, current_active_calls)`, with `CHECK (current_active_calls >= 0 AND current_active_calls <= max_concurrent_calls)`.

The claim (`lib/queue/claim.ts`) is one transaction:

1. `UPDATE hospital_capacity SET current_active_calls = current_active_calls + 1 WHERE hospital_id = $1 AND current_active_calls < max_concurrent_calls RETURNING current_active_calls` — zero rows means the hospital is at capacity; return null.
2. Select exactly one claimable task with `ORDER BY tier ASC, priority_score DESC, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`, filtered to campaigns still under their per-tick ceiling and excluding patients in cooldown.
3. `UPDATE outreach_tasks SET state = 'CALLING', claimed_by = $worker, lease_expires_at = now() + 5m, attempt_count = attempt_count + 1 ... RETURNING *`.
4. Zero task rows: release the capacity reservation taken in step 1 (still inside the same transaction) and return null.

**Why this is correct.** `FOR UPDATE SKIP LOCKED` guarantees two workers competing for the same rows never claim the same one — a locked row is invisible to a concurrent claimer, not blocking. The capacity `UPDATE ... WHERE current_active_calls < max_concurrent_calls` plus the `CHECK` constraint make over-subscription structurally impossible: Postgres serializes concurrent `UPDATE`s to the *same row* automatically (the second transaction blocks until the first commits, then re-evaluates its `WHERE` clause against the now-current value), so there is no window where two transactions both read "9 of 10 used" and both proceed. Both the capacity reservation and the task claim happen in one transaction, so a crash between them is impossible — either both happen or neither does.

**Release** (doc 07) decrements `current_active_calls` in the same transaction that writes the task's terminal state — never as a separate step, for the same crash-safety reason.

**Verified:** `tests/queue-concurrency.test.ts` fires 50 concurrent claim attempts against capacity 10, repeated 3 times (see that file for why 3, not the spec's 100, on this network) — passing means exactly 10 succeed each round, `current_active_calls` never exceeds 10, and no task id is ever claimed twice.

### Scoring cadence

`priority_score` and `tier` are stored columns, recomputed for every claimable task in one `UPDATE ... FROM` statement (`lib/queue/recompute.ts`) — never computed as an `ORDER BY` expression, so they stay indexable and inspectable (the score-explainability endpoint and any future dashboard read the same stored value the claim query sorted on). The bulk SQL is a direct translation of the pure `lib/queue/priority.ts` / `lib/queue/tier.ts` functions; `tests/queue-recompute.test.ts` cross-checks the two never drift apart.

## What doc 06 does not cover

- Turning an eligible patient into a callable task in the first place — that gap between doc 05 (eligibility) and doc 06 (claiming) is bridged by `lib/queue/materialize.ts`, wired into a campaign's transition to RUNNING.
- Retry backoff, callback rescheduling, dropped-call handling, and stale-lease recovery — doc 07 (below).
- The mandatory 20-30 patient simulation — doc 08.

---

# States, Retries, Callbacks & Failure Recovery (Doc 07)

## State machine

`lib/queue/state-machine.ts` declares every legal move; `assertValidTaskTransition` throws `IllegalTaskTransitionError` on anything else — there is no arbitrary `UPDATE state`. The graph matches the spec's diagram exactly, including two points worth calling out because they're easy to get wrong:

- **`CALLBACK_SCHEDULED` is only reachable from `CONNECTED`, never `CALLING`.** A patient can't request a callback on a call that never picked up. (A test originally asserted the opposite and was wrong, not the state machine — see `docs/dev-ai-usage.md`.)
- **`DECLINED` and `INVALID_NUMBER` are transient, not resting states.** The diagram shows `CALLING → DECLINED → COMPLETED` and `CALLING → INVALID_NUMBER → MANUAL_FOLLOW_UP` as two hops, both recorded in `outreach_task_state_transitions` — not a single jump straight to the final state. That keeps the history table an honest record of what actually happened.

## Outcome → policy

`lib/queue/outcome-policy.ts` is the literal table from the spec, as data — nothing branches on outcome strings scattered through the codebase, it all reads `OUTCOME_POLICY[outcome]`. The one design point worth restating: **`PROVIDER_ERROR` does not consume the patient's attempt budget.** Since `claim.ts` increments `attempt_count` unconditionally at claim time (before any outcome is known), "not consuming an attempt" means `recordCallOutcome` reverses that increment by one when the outcome is `PROVIDER_ERROR` — so the next real attempt reuses the same attempt slot rather than skipping ahead. A patient should never end up in manual follow-up because *our* infrastructure was down.

## Backoff

`lib/queue/backoff.ts`: `base[attempt] * (1 ± 20% jitter)`, then clamped forward in 15-minute steps until both the hospital's calling hours and the patient's stated preference are satisfied. If no such slot exists before the clinical window closes, the task goes straight to `MANUAL_FOLLOW_UP` with reason `WINDOW_WOULD_EXPIRE` — the system never schedules a call that legally cannot happen. `BUSY` (10 min) and `DROPPED` (5 min) use fixed backoffs instead of the base table, per the spec.

## Callbacks

`schedule_callback` (doc 10's tool surface) is expected to validate the requested time *during the conversation* and offer an alternative there if it's invalid. `lib/queue/callback.ts`'s `validateCallbackTime` is the backstop that makes "silently moved" structurally impossible even if that in-conversation check is ever skipped: `recordCallOutcome` refuses (throws `InvalidCallbackTimeError`) rather than schedule a `CALLBACK_REQUESTED` outcome outside calling hours or past the clinical window. A valid callback enters Tier 0 at claim time (doc 06) — time-pinned, not re-scored.

## Dropped-call context

`calls.partial_state jsonb` holds whatever the Voice Intake Agent (doc 10) captured before a drop — answered questions, reported symptoms, protocol step index, last utterance. `getMostRecentCallForTask` reads the prior attempt's `partial_state` back for the next one. Doc 07's job stops at "the data survives and is retrievable in order"; making the agent actually *use* it to resume instead of restart is doc 10's.

## Worker failure recovery

Every claimed task carries `lease_expires_at`, set to 5 minutes at claim time. `lib/queue/reaper.ts` (backed by `reapExpiredLeases` in the outreach-tasks repository, per the R2.3 rule that all queries live in the repository layer) finds `CALLING`/`CONNECTED` tasks whose lease has expired, resets them to `RETRY_SCHEDULED` with a fixed 2-minute delay, releases the capacity slot in the same transaction, and does **not** touch `attempt_count` — a crashed worker is never the patient's fault, and per PRD §11/§24 must never permanently hold capacity.

**Verified:** `tests/queue-reaper.test.ts` simulates the state a crashed worker leaves behind (a `CALLING` row with an expired lease and a reserved capacity slot — the closest a test gets to reproducing an actual `SIGKILL`) and confirms the task returns to `RETRY_SCHEDULED`, `attempt_count` is unchanged, `claimed_by`/`lease_expires_at` are cleared, and `hospital_capacity.current_active_calls` drops by exactly the number of reaped tasks. A task with a still-valid lease is left untouched.

## Duplicate prevention

`calls` carries `UNIQUE (outreach_task_id, attempt_number)`; `createCall` uses `ON CONFLICT DO NOTHING` on that constraint, so a retried write for the same attempt is a no-op, not a duplicate row. Idempotency keys of the form `{task_id}:{attempt}:{action}` for every other side effect (EHR writes, notifications, escalations) are doc 20's territory once those side effects exist.
