# Testing Strategy (Doc 22)

This doc is an audit, not a new build: by the time doc 22 was reached, every Tier 1 item and nearly every Tier 2 item was already covered by tests written alongside the doc that needed them (doc 06's queue tests, doc 12's triage tests, doc 21's eval harness, and so on). This file states what exists, where, and what deliberately doesn't — per this doc's own instruction: "test what is graded; skip the rest and say so."

## Setup (R1)

Real Postgres in every test — a `pgvector/pgvector:pg16` Docker container for local/CI runs (`.github/workflows/ci.yml`), migrated and RLS-applied before the suite runs. `MockProvider` for every AI call in every test **except** the safety eval harness (`eval/runner.ts`), which runs the real rule engine and consensus algorithm and documents exactly which parts are still pre-authored rather than live-model (`docs/safety-evaluation.md`'s methodology section). Every test file creates its own hospital (and campaign/patient/task fixtures) in its own `beforeAll` and is independently runnable — the suite doesn't rely on shared cross-file state, so tests can run in parallel in principle (this repo's `vitest.config.ts` sets `fileParallelism: false` specifically for the Supabase-pooler-latency reason documented in that file, not because the tests themselves share state).

`npm test` runs the full suite (`vitest run`).

## Tier 1 — must exist, graded directly

| Requirement | Covered by |
|---|---|
| Tenant isolation: repository + RLS + analytics + retrieval | `tests/tenancy.test.ts`, `tests/analytics-tenant-isolation.test.ts`, `tests/retrieval-cross-tenant.test.ts` |
| Queue concurrency: 50 workers / capacity 10 | `tests/queue-concurrency.test.ts` — run count scaled down from the spec's 100× due to this dev network's Supabase-pooler latency (documented in the test file itself); the scenario itself is exactly 50 concurrent `claimNextTask` calls against capacity 10 |
| Priority ordering worked example | `tests/queue-priority.test.ts` |
| Worker crash → reaper releases capacity, attempt not incremented | `tests/queue-reaper.test.ts` |
| Every outcome → correct retry/backoff/terminal behaviour | `tests/queue-record-outcome.test.ts`, `tests/queue-backoff.test.ts` |
| Callback honoured at requested time, Tier 0 | `tests/queue-priority.test.ts` |
| Consensus: one test per rule, plus rule-engine-overrides-both-LLMs | `tests/consensus.test.ts` (13 tests; rule 2 is exactly "rule engine fires a high-severity red flag, regardless of LLM opinions") |
| Triage validation: malformed → repair → fail → escalate | `tests/triage-run-assessor.test.ts` |
| Fabricated transcript quote rejected | `tests/triage-verify.test.ts` |
| Prompt injection does not change escalation | `tests/voice-intake.test.ts` (the `injection` persona) + all 6 adversarial cases in `eval/dataset/v1/adversarial.json` |
| Safety eval runs and reports FN rate | `eval/runner.ts` / `npm run eval:safety` — see `docs/safety-evaluation.md` |
| Idempotency: duplicate event/call/escalation → one side effect | Event: `tests/events-and-notifications.test.ts`. Escalation: `tests/escalation-consensus-integration.test.ts` (idempotent per `{outreach_task_id, attempt_number}`). Call: enforced by the same unique constraint, exercised at scale by the chaos test's "zero duplicate calls" assertion below rather than a single-duplicate unit test — both check the same DB constraint, the chaos test just does it under real concurrency-shaped load instead of a single deliberate retry. |
| Chaos test: 30% failures, no duplicates, no lost tasks, no leaked capacity | `tests/reliability-chaos.test.ts` |

**All Tier 1 items are covered.**

## Tier 2 — should exist

| Requirement | Covered by |
|---|---|
| RBAC allow/deny matrix per role per route | `tests/rbac.test.ts` |
| Campaign lifecycle guards, pause with active calls | `tests/campaign-integration.test.ts` |
| Eligibility rules individually | `tests/eligibility-rules.test.ts` |
| EHR failure → documented as failed → retried successfully | `tests/documentation-and-ehr.test.ts` |
| Calling hours and DST correctness | `tests/calling-hours.test.ts` |
| Window-expiry refuses to schedule an impossible call | `tests/queue-backoff.test.ts` |
| No PHI in logs | `tests/observability-phi-redaction.test.ts` |

**All Tier 2 items are covered.**

## Tier 3 — nice, deliberately not done

- **API contract tests** (e.g. OpenAPI schema validation on every route) — not built. The route handlers are exercised indirectly through the integration tests above (which assert on real response shapes), but there's no standalone contract-test layer. Given the 6-day budget, this was judged lower value than the Tier 1/2 work above, which is what's actually graded.
- **UI component tests** — not built. This build's frontend (docs 17/18) uses plain React components with inline styles, no component test harness (Testing Library, etc.) was set up. Pages are verified via `npx next build` (compiles cleanly) and by their data contracts matching the same repository functions the integration tests already exercise — documented explicitly in `docs/escalation-management.md` and `docs/dashboards-and-analytics.md` as "no interactive browser testing was possible in this environment."
- **E2E with Playwright** — not built, for the same reason: no browser tooling available in this environment, and the 6-day budget prioritized backend correctness (queue, consensus, reliability) over end-to-end UI automation, per PRD §34's own stated grading weights.

## Known test-environment characteristics (not bugs)

- This dev/CI environment's real Postgres runs sequentially (`fileParallelism: false`) rather than in parallel, specifically because early in this build sequential Supabase-pooler round trips at several seconds each made parallel file execution look like hangs. Running against a local Docker Postgres (used throughout this session for fast iteration) doesn't have that latency and could safely run in parallel, but the config is shared with CI's Supabase-backed runs, so it stays conservative.
- A long-lived local test database accumulates hospitals across many test-file runs over a session (each file's `beforeAll` creates fresh fixtures and doesn't delete them at the end, by design — see `tests/rbac.test.ts`'s own comment on why: an `audit_log` row referencing a hospital makes full cleanup impossible without violating the append-only constraint doc 01 requires). This has, more than once this session, made a per-hospital-loop query (doc 18's platform analytics, doc 19's health check) slow enough to need resetting the disposable container — never a problem in CI, which starts from a fresh database every run.

## Reproducing a green run

```
npm run db:migrate
npm run db:rls
npm test
```

Latest full run: 41 test files, 225 tests, all passing (see `.github/workflows/ci.yml`'s run history for the authoritative, always-current result — pasting a point-in-time count here would go stale the next time a doc changes anything).
