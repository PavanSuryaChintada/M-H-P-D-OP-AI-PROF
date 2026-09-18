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
- Retry backoff, callback rescheduling, dropped-call handling, and stale-lease recovery — doc 07.
- The mandatory 20-30 patient simulation — doc 08.
