# 22 — Testing Strategy

**PRD:** §29 · **Depends on:** all

---

## Scope
What to test given a 4-day budget. Test what is graded; skip the rest and say so.

## Priority order (if you run out of time, cut from the bottom)

**Tier 1 — must exist, these are graded directly**
- [ ] Tenant isolation: repository + RLS + analytics + retrieval (doc 01, 11, 18)
- [ ] Queue concurrency: 50 workers / capacity 10, ×100 runs (doc 06)
- [ ] Priority ordering: the worked example reproduces exactly (doc 06)
- [ ] Worker crash → reaper releases capacity, attempts not incremented (doc 07)
- [ ] Every outcome → correct retry/backoff/terminal behaviour (doc 07)
- [ ] Callback honoured at requested time, Tier 0 (doc 07)
- [ ] Consensus: one test per rule, plus rule-engine-overrides-both-LLMs (doc 13)
- [ ] Triage validation: malformed → repair → fail → escalate (doc 12)
- [ ] Fabricated transcript quote rejected (doc 12)
- [ ] Prompt injection does not change escalation (doc 02, 21)
- [ ] Safety eval runs and reports FN rate (doc 21)
- [ ] Idempotency: duplicate event/call/escalation produces one side effect (doc 20)
- [ ] Chaos test: 30% failures, no duplicates, no lost tasks, no leaked capacity (doc 20)

**Tier 2 — should exist**
- [ ] RBAC allow/deny matrix per role per route (doc 02)
- [ ] Campaign lifecycle guards, pause with active calls (doc 05)
- [ ] Eligibility rules individually (doc 05)
- [ ] EHR failure → documented as failed → retried successfully (doc 15)
- [ ] Calling hours and DST correctness (doc 03)
- [ ] Window-expiry refuses to schedule an impossible call (doc 07)
- [ ] No PHI in logs (doc 19)

**Tier 3 — nice**
- [ ] API contract tests, UI component tests, E2E happy path with Playwright

## Requirements
- **Use a real Postgres in tests** (testcontainers or a docker-compose service). Concurrency and RLS cannot be tested against a mock. This is not optional for Tier 1.
- `MockProvider` for AI in all tests except the safety eval, which uses real models.
- Every test seeds and tears down its own tenant, so tests can run in parallel.
- `npm test` runs Tier 1 + 2 and must be green at submission.

## Key deliverables
- [ ] Vitest setup with a Postgres test container
- [ ] All Tier 1 tests passing
- [ ] `npm test` green, output screenshot for the README
- [ ] A short `docs/testing.md` stating what is covered and **what deliberately is not**

## Claude Code prompt
```
Set up testing per this spec.

1. Vitest with a real Postgres via testcontainers (or a docker-compose service). Migrations
   and RLS policies applied before the suite. Each test creates its own hospital tenant and
   cleans up, so the suite can run in parallel.
2. Use MockProvider for AI everywhere except the safety eval.
3. Implement every Tier 1 test listed in this spec, in that order. Do not move to Tier 2
   until all Tier 1 tests pass.
4. Then implement Tier 2.
5. npm test runs Tier 1 and 2.
6. Write docs/testing.md listing coverage and explicitly naming what is not tested and why.
```
