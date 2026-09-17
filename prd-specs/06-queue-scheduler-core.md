# 06 — Outbound Queue: Priority & Concurrency Control

**PRD:** §10, §34 · **Depends on:** 05 · **THE HIGHEST-WEIGHTED DOCUMENT IN THE PACK**

> PRD §10: *"You must design and document an actual prioritization algorithm. Do not simply state that the queue uses 'priority.'"*
> Everything below exists to answer that sentence.

---

## Scope
How the next patient is chosen, and how capacity is enforced when many workers compete.

---

## 1. The priority algorithm — specify exactly this

### Three-tier selection, scored within tier

Selection is **tiered first, scored second**. Tiers exist because some conditions must dominate any score.

```
TIER 0 — TIME-PINNED
  Callbacks whose requested time has arrived (within ±10 min).
  A patient who asked to be called at 15:00 is called at 15:00, not "when their score wins".
  Ordered by requested_time ascending.

TIER 1 — CUTOFF RISK
  Tasks where remaining_window_ratio < 0.20, OR absolute time remaining < 2 hours.
  These will be lost entirely if not called now.
  Ordered by absolute time remaining ascending.

TIER 2 — SCORED POOL
  Everything else, ordered by priority_score descending, then created_at ascending.
```

### The score (Tier 2)

```
priority_score =
    0.40 * deadline_pressure
  + 0.30 * clinical_risk
  + 0.15 * campaign_weight
  + 0.10 * wait_age
  - 0.05 * attempt_penalty
```

| Term | Definition | Range |
|---|---|---|
| `deadline_pressure` | `1 - (time_remaining / total_window)`, clamped | 0–1 |
| `clinical_risk` | `{low:0.1, medium:0.4, high:0.7, critical:1.0}` from discharge risk indicators | 0–1 |
| `campaign_weight` | campaign `priority_weight` normalised across that hospital's running campaigns | 0–1 |
| `wait_age` | `min(hours_since_eligible / 24, 1)` — **starvation prevention** | 0–1 |
| `attempt_penalty` | `min(attempts / max_attempts, 1)` — repeatedly unreachable patients yield to reachable ones | 0–1 |

**Why these weights (write this in the design doc):** deadline pressure dominates because a missed clinical window is an unrecoverable failure, while a delayed call is recoverable. Clinical risk is second because a high-risk patient's call carries more expected value. Campaign weight is an operator lever, deliberately weaker than clinical factors so business priority can never outrank patient safety. Wait-age guarantees monotonic progress toward selection so nothing starves. Attempt penalty is subtractive and small — it should nudge ordering, never exclude.

### Worked example (put this in the design doc)

| Patient | Risk | Window left | Window total | Attempts | Score | Selected |
|---|---|---|---|---|---|---|
| A | critical | 20h / 24h | 24h | 0 | 0.40×0.17 + 0.30×1.0 + 0.15×0.8 + 0.10×0.1 − 0 = **0.50** | 2nd |
| B | low | 1.5h / 48h | 48h | 1 | **Tier 1** (under 2h) | **1st** |
| C | high | 6h / 24h | 24h | 0 | 0.40×0.75 + 0.30×0.7 + 0.15×0.8 + 0.10×0.4 = **0.67** | — |

Ordering: B (tier 1) → C (0.67) → A (0.50). **State this explicitly:** a low-risk patient beats a critical-risk patient here, because the critical patient still has 20 hours and the low-risk one has 90 minutes. That is the intended behaviour and PRD §10 asks for exactly this reasoning.

### Fairness between competing campaigns

Per scheduler tick, each running campaign's claim ceiling is:

```
campaign_ceiling = max(1, floor(free_capacity * campaign_weight / Σ weights))
```

Guarantees every running campaign gets at least one slot per tick, so a high-weight campaign cannot fully starve a low-weight one. Combined with `wait_age`, starvation is prevented by two independent mechanisms — say so.

### Patient-level cooldown
A patient eligible for two campaigns is never called twice within `patient_call_cooldown_minutes` (default 120). Enforced at claim time by a `NOT EXISTS` clause on recent calls for that `patient_id`.

---

## 2. Concurrency control — the part that must be provably correct

### Mechanism

A `hospital_capacity` row per hospital: `(hospital_id, max_concurrent, active_count)` with a DB-level `CHECK (active_count >= 0 AND active_count <= max_concurrent)`.

Claim, in **one transaction**:

```sql
BEGIN;

-- 1. Reserve capacity. CHECK constraint makes over-subscription impossible.
UPDATE hospital_capacity
   SET active_count = active_count + 1
 WHERE hospital_id = $1
   AND active_count < max_concurrent
RETURNING active_count;
-- 0 rows => hospital at capacity, ROLLBACK and move on

-- 2. Claim exactly one task, skipping rows other workers hold.
WITH next AS (
  SELECT id FROM outreach_tasks
   WHERE hospital_id = $1
     AND state IN ('PENDING','RETRY_SCHEDULED','CALLBACK_SCHEDULED')
     AND scheduled_for <= now()
     AND campaign_id = ANY($2)          -- campaigns under their ceiling
     AND NOT EXISTS (                    -- patient cooldown
       SELECT 1 FROM calls c
        WHERE c.patient_id = outreach_tasks.patient_id
          AND c.started_at > now() - interval '120 minutes')
   ORDER BY tier ASC, priority_score DESC, created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED
)
UPDATE outreach_tasks t
   SET state = 'CALLING',
       worker_id = $3,
       lease_expires_at = now() + interval '5 minutes',
       attempts = attempts + 1,
       claimed_at = now()
  FROM next WHERE t.id = next.id
RETURNING t.*;
-- 0 rows => nothing claimable; decrement capacity and ROLLBACK

COMMIT;
```

**Why this is correct:** `FOR UPDATE SKIP LOCKED` guarantees two workers never claim the same row. The capacity `UPDATE … WHERE active_count < max_concurrent` plus the `CHECK` guarantees the limit cannot be exceeded even under arbitrary concurrency, because the row lock serialises it. Both are in one transaction, so a crash between them is impossible.

**Release** decrements `active_count` in the same transaction that writes the terminal task state. Never in a separate step.

### Scoring cadence
`priority_score` is a stored column recomputed by the scheduler tick (every 15s) for all claimable tasks in one `UPDATE … FROM` statement. Do **not** compute it in the `ORDER BY` — you need it indexable and inspectable in the dashboard.

---

## Key deliverables
- [ ] `lib/queue/priority.ts` — pure `computeScore(task, campaign, now)`, unit tested against a fixture table
- [ ] `lib/queue/tier.ts` — tier assignment
- [ ] `lib/queue/claim.ts` — the transactional claim above
- [ ] `lib/queue/scheduler.ts` — tick: recompute scores → compute ceilings → claim loop
- [ ] `hospital_capacity` table with the CHECK constraint
- [ ] **Concurrency proof test:** 50 parallel workers against capacity 10 → `active_count` never exceeds 10, no task claimed twice. Run it 100 times in CI.
- [ ] Score explainability endpoint: `GET /api/tasks/:id/score` returning each term's contribution
- [ ] `docs/queue-design.md` §priority + §concurrency (deliverable 5)

## Acceptance criteria
- 50 concurrent claim attempts, capacity 10: exactly 10 succeed, `active_count = 10`, zero duplicate claims.
- The worked example above reproduces exactly in a test.
- Dashboard can show, for any pending task, why it ranks where it does.

## Claude Code prompt
```
Implement the outbound queue priority and concurrency control per docs 01, 03, 05.
This is the highest-graded component. Follow the spec literally.

1. hospital_capacity(hospital_id PK, max_concurrent int, active_count int) with
   CHECK (active_count >= 0 AND active_count <= max_concurrent).
2. lib/queue/priority.ts: computeScore = 0.40*deadline_pressure + 0.30*clinical_risk +
   0.15*campaign_weight + 0.10*wait_age - 0.05*attempt_penalty, with each term defined
   exactly as in this spec. Pure function, no DB access.
3. lib/queue/tier.ts: TIER 0 callbacks due within +/-10min; TIER 1 remaining_ratio < 0.20 OR
   under 2 hours absolute; TIER 2 everything else.
4. lib/queue/claim.ts: single transaction that (a) conditionally increments active_count,
   (b) selects one task ORDER BY tier ASC, priority_score DESC, created_at ASC with
   FOR UPDATE SKIP LOCKED, applying the patient cooldown NOT EXISTS clause and the campaign
   ceiling filter, (c) sets state CALLING with worker_id, lease_expires_at = now()+5min,
   attempts+1. Rollback and decrement if no task claimed.
5. lib/queue/scheduler.ts tick every 15s: bulk-recompute priority_score for claimable tasks
   in one UPDATE, compute per-campaign ceilings as max(1, floor(free_capacity * weight /
   sum_weights)), then claim in a loop until capacity is exhausted or nothing is claimable.
6. Release capacity in the SAME transaction that writes the terminal task state.
7. GET /api/tasks/:id/score returning every term and its contribution.
8. Write a concurrency test: 50 parallel claim calls against capacity 10. Assert exactly 10
   succeed, active_count never exceeds 10, and no task id is claimed twice. Repeat 100x.
9. Write a fixture test reproducing the worked example in this spec exactly.
```

## Do not
- Do not use `SELECT … LIMIT 1` without `FOR UPDATE SKIP LOCKED`.
- Do not enforce capacity by counting `CALLING` rows in application code — it races.
- Do not put the score in `ORDER BY` as an expression.
