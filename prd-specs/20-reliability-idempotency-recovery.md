# 20 — Reliability, Idempotency & Recovery

**PRD:** §24 · **Depends on:** 07, 15, 16

---

## Scope
Behaving correctly when things fail. PRD §24 lists the failures it expects you to handle — handle them explicitly and name them in the docs.

## Requirements

**R1 — Idempotency keys** on every operation where duplicate execution causes harm:

| Operation | Key |
|---|---|
| Start call | `{task_id}:{attempt}` |
| Record outcome | `{call_id}:outcome` |
| Create escalation | `{task_id}:{attempt}:escalation` |
| Send notification | `{escalation_id}:{stage}:{channel}` |
| EHR write | `{call_id}:{resource_type}` |
| Process discharge | `{source_message_id}` |
| Consume event | `{event_id}` |

Store in an `idempotency_keys` table with the original result. Replay returns it.

**R2 — Failure taxonomy, each with a defined behaviour:**

| Failure | Behaviour |
|---|---|
| AI provider outage | retry ×2, then `PROVIDER_ERROR`, attempt not consumed, circuit breaker opens |
| AI malformed output | one repair, then explicit failure → escalate (doc 12) |
| Voice provider failure | outcome `PROVIDER_ERROR`, retry scheduled |
| Database failure | request fails loudly, worker backs off, health → DEGRADED |
| EHR failure | write marked `failed`, retried by background job, visible |
| Worker crash | lease expiry → reaper releases capacity (doc 07) |
| Notification failure | recorded with error, retried, escalation still visible in-app |
| Timeout | treated as failure, never as success |
| Rate limit (429) | backoff with `Retry-After` honoured |
| Interrupted call | `DROPPED` with `partial_state` preserved |

**R3 — Circuit breaker** per external dependency: 5 consecutive failures → open for 60s → half-open probe. Open breaker on the primary AI provider means consensus runs with the remaining assessors and **the reduced-assessor case escalates** (consensus rule 4, doc 13). Never silently proceed with fewer voters.

**R4 — Timeouts everywhere:** AI 30s, EHR 10s, call turn 20s. No unbounded await.

**R5 — Graceful shutdown:** on `SIGTERM` stop claiming, finish in-flight work up to 30s, release capacity, exit. A deploy must not orphan tasks.

**R6 — Recovery runbook** in `docs/runbook.md`: stuck task, dead-letter replay, EHR backlog, worker not claiming, capacity leak. Short, practical, one page.

## Key deliverables
- [ ] `idempotency_keys` table + `withIdempotency()` helper
- [ ] All seven operations keyed per R1
- [ ] Circuit breaker + reduced-assessor escalation path
- [ ] Timeouts on every external call
- [ ] Graceful shutdown handler
- [ ] `docs/runbook.md`
- [ ] Chaos test: 30% injected failure across AI, EHR and worker crashes over a 50-task run — assert zero duplicate calls, zero lost tasks, zero leaked capacity

## Acceptance criteria
- The chaos test passes repeatedly. This single test is the strongest reliability evidence you can show a grader.

## Claude Code prompt
```
Implement reliability, idempotency and recovery per docs 07, 15 and 16.

1. idempotency_keys table storing key, operation, result jsonb, created_at.
   withIdempotency(key, fn) returns the stored result on replay without re-executing.
   Apply it to the seven operations listed in this spec.
2. Implement the failure taxonomy table exactly: AI outage retries twice then PROVIDER_ERROR
   without consuming a patient attempt; malformed AI output repairs once then escalates;
   EHR failures mark failed and retry in background; worker crash handled by the lease
   reaper; timeouts always count as failure; 429 honours Retry-After; interrupted calls
   become DROPPED with partial_state preserved.
3. Circuit breaker per external dependency: 5 consecutive failures opens for 60s, then a
   half-open probe. When a breaker removes one of the three assessors, consensus must run
   with fewer voters AND escalate under rule 4. Never proceed silently.
4. Timeouts: AI 30s, EHR 10s, call turn 20s. No unbounded awaits anywhere.
5. SIGTERM handler: stop claiming new tasks, allow in-flight work up to 30s, release
   capacity, exit cleanly.
6. Write docs/runbook.md covering stuck task, dead-letter replay, EHR backlog, worker not
   claiming and capacity leak.
7. Write a chaos test: 50 tasks with 30% injected failures across AI calls, EHR writes and
   simulated worker crashes. Assert zero duplicate calls, zero tasks left non-terminal,
   zero leaked capacity, and that active_count returns to 0 at the end.
```
