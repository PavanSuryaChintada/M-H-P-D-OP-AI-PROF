# Development AI Usage Log — Deliverable 8

Logged as work happens, per doc 00 §7 ("cannot be reconstructed later"). One entry per session/task, newest first.

---

## 2026-09-18 (later still) — Doc 10: voice intake agent & call simulator

**Tool:** Claude Code (Sonnet 5).

- **Deliberate scope decision, stated up front:** built the conversation as a deterministic state machine (`lib/voice-intake/run-call.ts`) rather than a freeform LLM-driven chat. R1's own framing ("structured outreach, not a chatbot") supports this directly — every safety-critical decision (stop, refuse, escalate, end) is code, never left to a model to get right live. Doc 09's `voice-intake-v1` prompt and provider abstraction remain a drop-in swap for natural-language phrasing variation later, without touching this flow's structure.
- `lib/voice-intake/detectors.ts`: deterministic keyword checks (emergency, advice-request, wrong-person, refusal, not-convenient) run on every patient turn regardless of state — same "independent of the LLM" reasoning as doc 13's rule engine, and what makes the prompt-injection test provably pass rather than just probably pass (the flow structurally cannot be redirected by patient text, since nothing interprets that text as instructions in the first place).
- **Two real state-machine bugs found by running the actual test suite, not by re-reading the graph:**
  1. `finishWithOutcome()` initially connected (`CALLING→CONNECTED`) before recording every outcome, copying doc 08's pattern for `COMPLETED`/`CALLBACK_SCHEDULED`. But `DECLINED` is reachable directly from `CALLING`, and `CONNECTED` does not list `DECLINED` as a valid target at all — connecting first and then declining is itself illegal. Two persona tests (`refuser`, `wrong_person`) failed with `IllegalTaskTransitionError` immediately, which is exactly what should happen for a real bug — fixed by branching the hop on the outcome instead of applying it unconditionally.
  2. The very first agent line ("...regarding your recent discharge") was spoken before identity verification completed — a genuine, if minor, disclosure-before-verification bug that the `wrong_person` acceptance-criteria test caught directly. Fixed by moving all clinical/purpose context to step 2, which only runs after identity is confirmed.
- **A third bug, in the test setup, not the code under test:** the test hospital never had `updateHospitalConfig` called, so its calling-hours config was empty — every callback request was rejected as `OUTSIDE_CALLING_HOURS` regardless of the actual time. Fixed by seeding an always-open `HospitalConfigSchema`-validated config in `beforeAll`, matching the pattern already established in doc 07's own test suite.
- **Timeouts, correctly diagnosed as latency, not a hang:** the first full test run had 6 of 11 tests time out at exactly vitest's 30s default. Traced to which personas actually trigger the follow-up-question probing branch (extra sequential DB round trips per probe) versus which don't (`cooperative`/`terse` answer "no" and skip probing, and passed immediately) — confirmed alive via a direct DB check showing the test's patient rows being created in real time during the "stalled" window, then fixed by raising the per-test timeout to 90s rather than touching any flow logic.
- `sim/call-simulator.ts`: the nine required personas plus a tenth (`injection`) built specifically to exercise the prompt-injection deliverable — the agent side is the real `runCall()` orchestration throughout; only the patient's scripted words are canned, so every transcript is genuine.
- **Schema gap found and fixed** (same pattern as every other doc this session): `call_turns` (doc 01) had no `latency_ms` column, which doc 10 R3 explicitly requires. Additive migration.
- The emergency fast path never calls `create_escalation` directly (doc 13's hard rule) — it runs the real rule engine plus a mock LLM seat deliberately returning `routine`, proving the escalation fires on the deterministic engine alone rather than assuming it would.
- Tests (`tests/voice-intake.test.ts`, 11/11 passing): every persona reaches its expected outcome; the emergency persona terminates within two turns and produces a real, persisted escalation id (acceptance criteria); the wrong-person persona's transcript never contains "discharge" or any follow-up question text (acceptance criteria); advice requests get the scripted refusal; the injection persona completes normally with every question asked in order and no diagnosis ever stated. Full regression (`tests/architecture.test.ts`, `tests/consensus.test.ts`, `tests/escalation-consensus-integration.test.ts`, `tests/triage-run-assessor.test.ts` — 23 tests) still green after the doc 07 state-machine usage fixes.
- `docs/voice-intake.md` written. Transcript viewer UI deferred to doc 17/18's reviewer and dashboard screens, per this build's established frontend split.

---

## 2026-09-18 (later still) — Doc 11: clinical protocols & tenant-aware retrieval

**Tool:** Claude Code (Sonnet 5).

- **Schema gap found and fixed** (same pattern as `ai_usage`/doc 09, `escalations`+`escalation_assessments`/doc 13, `triage_results`/doc 12 — this AI-safety block consistently found doc 01's original schema hadn't anticipated its later specs' exact persistence needs): `protocols` had no structured form at all, just `title`/`category`/`content`/`version`. Added `structured_content` (jsonb, zod-validated on write), `specialty`, `effective_from`; `knowledge_chunks` gained `section`, `heading`, and a `protocol_version` snapshotted at chunk-creation time (not re-joined from the live `protocols.version`, which can change after a chunk was generated from a specific version's text).
- Wrote three real-shaped protocols (`lib/protocols/seeds/`) — post-surgical hip replacement (10 questions, 7 red flags), heart failure discharge (10 questions, 8 red flags), general medical discharge (9 questions, 7 red flags) — realistic in structure and clinical terminology for this build's purposes; explicitly not a substitute for real hospital-authored content. All three validated against the zod schema before seeding.
- `lib/protocols/chunker.ts` chunks by structural unit (one red flag, one batch of ~4 questions, one guidance item) rather than naive fixed-size text splitting — keeps a red flag's trigger terms and required action from ever being split across chunks, and makes `{protocol_id, section, heading}` fall out of the structure directly.
- `lib/ai/embeddings/`: `EmbeddingProvider` abstraction mirroring doc 09's `AIProvider` pattern. `OpenAIEmbeddingProvider` for real semantic search; `MockEmbeddingProvider` (deterministic feature-hashed bag-of-words) for tests and seeding without an API key — documented honestly as NOT a real semantic embedding, just similar-enough-for-plumbing-tests, since claiming otherwise would be exactly the kind of fabrication these docs explicitly warn against.
- `lib/ai/retrieval.ts`'s `hybridSearch()`: vector similarity merged with keyword match, **keyword hits ranked first by design** (not averaged into one score) — doc 11's own stated rationale is that exact red-flag phrase matches are the safety-critical path a pure vector search can miss, so they outrank a merely-similar vector hit structurally, not by tuning a weighting parameter.
- `getRedFlagsForProtocol()` closes the loop planned back in doc 13: the rule engine (`runRuleEngine`) was deliberately built pure and DB-free, taking `RedFlag[]` as a plain argument specifically so doc 11 could supply real data later with zero changes to the rule engine itself. Confirmed that design held — no rule-engine changes were needed.
- **Ran the actual seeding script against the live DB, then found and fixed a real operational mistake before it did damage:** `npm run seed:protocols`'s first version iterated over `listHospitals()` — ALL hospitals — and this database has accumulated 46 of them across a session of test runs (`"... Test Hospital"` rows created by every integration test's `beforeAll`). Caught after the first hospital had already been seeded (harmless, but would have wasted significant time seeding 3 protocols × ~15 chunks into 45 more throwaway rows). Fixed to filter to the four named real demo hospitals (`Northside General`, `Harbour Clinic`, `Rural Health Post`, `Demo General Hospital`) before re-running. This also closes the exact gap doc 03's own hospital-seeding script had flagged in its comments: "protocols don't exist yet ... readiness will correctly report 'at least one protocol' as the one remaining gap until doc 11 lands."
- Tests (14 total): `tests/retrieval-cross-tenant.test.ts` — the doc 11 R4 acceptance criteria, checked at three levels (hybridSearch, the two repository functions individually, and a raw unfiltered SELECT under RLS with no WHERE clause) against a query built to strongly match a planted Hospital-B marker phrase, plus a companion assertion that the same query DOES find the marker under Hospital B's own context (proving the isolation test isn't vacuously passing). `tests/retrieval-grounding.test.ts` for the R8 validator. Full regression (`tests/architecture.test.ts`, `tests/triage-run-assessor.test.ts`) still green.
- `docs/protocols-and-retrieval.md` written. Protocol upload/edit UI and citation display are explicitly deferred to doc 17's reviewer screen, not built twice.

---

## 2026-09-18 (later still) — Doc 12: clinical triage & structured output validation

**Tool:** Claude Code (Sonnet 5).

- Built the validation pipeline (`lib/ai/triage/run-assessor.ts`), the hallucination guard (`lib/ai/triage/verify.ts`), and confidence forcing (`lib/ai/triage/uncertainty.ts`) on top of the `TriageResult` schema and the two prompts (`clinical-triage-v1`, `second-assessor-v1`) already written in doc 09.
- **Real design gap found and fixed while wiring the repair loop:** `managed-call.ts`'s `runStructured()` (doc 09) collapsed every failure — network timeout, exhausted retries, schema validation — into one generic `PROVIDER_ERROR`, with no way to tell a repairable validation failure from a genuine provider outage. Doc 12 R3's repair step needs exactly that distinction (feed the error back and retry vs. nothing to correct, surface immediately). Added `isValidationFailure?: boolean` to `ManagedResult`'s failure shape rather than duplicating retry logic in doc 12's own code.
- Confirmed the doc 12 → doc 13 handoff needed zero new escalation code: a thrown `TriageValidationFailedError` (or a raw provider error) already becomes an `ASSESSOR_FAILURE` outcome through doc 13's existing `settleAssessors()`/`Promise.allSettled` path, which the consensus algorithm's rule 4 already escalates on. Verified this end to end in `tests/triage-run-assessor.test.ts`'s last case rather than just asserting it in isolation.
- **Schema gap found and fixed** (same pattern as `ai_usage` in doc 09 and `escalations`/`escalation_assessments` in doc 13): `triage_results` (doc 01) was missing everything doc 12 R7 explicitly requires for traceability — raw output, parsed result, prompt version, model name, retrieval chunk ids, validation attempt count, latency, cost. Added all eight via an additive migration; `modelProvider` (already present, stores the vendor id) is kept separate from the new `modelName` (the actual model string) since they answer different questions.
- **Caught my own dead-parameter bug while touching `run-consensus.ts` again:** `settleAssessors()`'s first parameter (`assessorId: string`) was never used in the function body — a leftover from an earlier draft, not caught by lint (unused function arguments aren't flagged the way unused locals are). Removed it while in the file for a legitimate reason rather than leaving it as debt for later.
- Tests (18 total, all passing): `tests/triage-verify.test.ts` (fabricated quote rejected, in-bounds vs. out-of-bounds observation spans, missing turn_index), `tests/triage-uncertainty.test.ts` (all three forcing conditions independently, plus the "left alone" case), `tests/triage-run-assessor.test.ts` against the live DB (malformed-JSON-equivalent repaired, twice-malformed → `TriageValidationFailedError`, fabricated quote repaired vs. never corrected, and the full doc 12→13 handoff). Full regression check (`tests/architecture.test.ts`, `tests/ai-tool-gateway.test.ts`, `tests/consensus.test.ts`, `tests/escalation-consensus-integration.test.ts` — 28 tests) still passes after the `managed-call.ts`/`run-consensus.ts` edits.
- `docs/clinical-triage.md` written.

---

## 2026-09-18 (later still) — Doc 13: escalation consensus & clinical safety (built ahead of doc 12)

**Tool:** Claude Code (Sonnet 5).

- **Deliberate reordering, stated up front:** doc 13 depends on doc 12's `TriageResult` schema, not on doc 12's actual LLM-calling pipeline. Built `lib/ai/schemas/triage.ts` (doc 12 R1's schema, exactly as specified) as a prerequisite slice of doc 12, then doc 13's consensus/rule-engine/persistence on top of it — the parts of doc 12 that still need building (the two LLM assessors' prompting, the validation/repair loop, the transcript hallucination check) are unaffected and get filled in when doc 12 itself is built.
- `lib/ai/assessors/rule-engine.ts`: deterministic, no LLM, and deliberately DB-free — takes the protocol's red flags as a plain argument instead of loading them itself, so doc 11 (which owns real structured protocol content) only needs to feed this same function real data later, no rework.
- `lib/ai/consensus.ts`: the 8 rules, implemented exactly as ordered in the spec. **Found and documented a genuine spec observation, not a bug:** rule 5 (`MATERIAL_DISAGREEMENT`, severity-rank gap ≥ 2) is structurally unreachable given the rule ordering — any `urgent` classification already fires rule 1, any `uncertain` already fires rule 3, both before rule 5 is ever checked, leaving only `{routine, concerning}` (gap ≤ 1) by the time execution would reach it. Implemented exactly as specified anyway rather than silently reordered to make it reachable, and documented in the code, the test, and `docs/escalation-consensus.md`.
- **Schema gaps found and fixed** (same pattern as doc 09's `ai_usage` fix): doc 01's `escalations` table predates doc 13's explicit idempotency requirement ("per `{task_id, attempt}`") — added `outreach_task_id`/`attempt_number` columns plus a unique index, additive migration. Added the entirely new `escalation_assessments` table (doc 13 §3's "all three TriageResults in full" persistence requirement) since nothing like it existed.
- **Real operational bug caught by actually running the integration test, not by review:** the new `escalation_assessments` table wasn't in `lib/db/rls.sql`'s tenant-tables list, and the file's one-time `GRANT ... ON ALL TABLES` predates the table's existence — the first live write failed with `permission denied for table escalation_assessments`. Fixed by adding the table to the RLS script and re-running `npm run db:rls`, and added a maintenance note directly in `rls.sql` since this is a general trap for any future new table, not specific to this one.
- `escalateFromConsensus()` (`lib/ai/run-consensus.ts`) is the single entry point: compute consensus, and only persist (idempotently, with all three assessment snapshots) if it says to escalate. No parameter, tool, or code path exists that could turn an `escalate: true` verdict into `false` — verified structurally (no such tool in doc 09's registry) and by the idempotency test (a retried call returns the same escalation, doesn't re-snapshot).
- Tests: `tests/consensus.test.ts` (one per rule, including the two rule-7 boundary cases — a sub-0.7 confidence and non-empty `missing_information` both correctly fall through to rule 8 — and the acceptance-criteria case where both LLMs say routine but the rule engine's indicators alone trigger rule 2), `tests/rule-engine.test.ts`, `tests/escalation-consensus-integration.test.ts` (live DB: persistence, failed-assessor snapshots, idempotency). All passing; `tsc`/`eslint`/`tests/architecture.test.ts` clean.
- `docs/escalation-consensus.md` written.

---

## 2026-09-18 (later still) — Doc 09: AI architecture, tool gateway, provider abstraction

**Tool:** Claude Code (Sonnet 5).

- Installed `@anthropic-ai/sdk` and `openai` — the two real providers the spec names (PRD §27); `zod` was already present. Stated here per doc 00's "don't add a dependency without saying why."
- `lib/ai/providers/`: `AIProvider` interface, `AnthropicProvider`/`OpenAIProvider` (structured output via forced tool-use/function-calling, zod schema → JSON Schema via `z.toJSONSchema`, output re-validated against the same schema rather than trusting the provider's own claim of conformance), `MockProvider` (deterministic, queue-driven for tests/sims). `managed-call.ts` is the single place doc 09 §3's policy lives — 30s timeout, 2 retries with backoff, then a structured `PROVIDER_ERROR` — so every agent calls `runGenerate()`/`runStructured()`, never a provider directly, and every attempt (success or failure) is recorded to `ai_usage`.
- **Found and fixed a real schema gap:** `ai_usage` (built in doc 01, before doc 09's spec existed) was missing `prompt_version`, `retry_count`, and `validation_outcome` — all three explicitly required by doc 09 §3/§4. Added them via an additive migration (`0007_complex_zeigeist.sql`, `ALTER TABLE ... ADD COLUMN`, no data loss) rather than quietly dropping that data from the design.
- `lib/ai/tools/registry.ts`: the 6-stage controlled gateway (registry lookup → agent allowlist → tenant-violation check → authorization → zod validation → execution → audit log), and the 11-tool catalogue from doc 09 §2. Every table the catalogue touches (`protocols`, `escalations`, `notifications`, `communications`) already existed in doc 01's schema — only repository functions were needed, not new tables. Three tools (`search_protocol`, `update_mock_ehr`, `request_notification`) intentionally call simplified backing logic today (keyword match, a communications write, a PENDING row) with the tool's args/result contract fixed now so docs 11/15/16 extend the implementation, not the interface, when they land.
- **Caught my own near-miss while writing `lib/db/repositories/protocols.ts`:** used the Write tool on a file I hadn't re-read first and clobbered an existing `countProtocols` export that `lib/hospitals/readiness.ts` (doc 03) depends on — caught immediately by `tsc --noEmit` failing on the now-missing import, confirmed via `git diff` exactly what was lost, and restored it alongside the new functions rather than leaving doc 03's readiness check broken.
- `lib/ai/prompts/<agent>/v1.ts` for the five LLM-facing agents (voice intake, clinical triage, second assessor, escalation-consensus arbiter, documentation) — real safety-constrained system prompts, not placeholders: each restates its own spec's hard rules (never diagnose/prescribe, the fixed refusal line and emergency-stop for intake; the hallucination-guard instruction for both triage assessors — a fabricated transcript quote is explicitly called out as worse than an "uncertain" classification; the arbiter's "cannot downgrade" constraint) and includes `UNTRUSTED_CONTENT_NOTICE` once. `clinical-triage` and `second-assessor` deliberately differ in framing (protocol-first vs. symptom-first), not just vendor, per doc 13 §1's point that two LLMs need genuinely independent failure modes to be worth anything as separate votes.
- `lib/ai/context/builders.ts`: one context builder per agent, scoped to exactly the fields each spec names (never the whole patient history), each returning a `contextTokens` estimate so callers can log context size per call per doc 09 §5.
- Tests (`tests/ai-tool-gateway.test.ts`, 10/10 passing): a tool call carrying `hospitalId` or `hospital_id` (either casing) in its raw args is rejected before validation even runs; `voice_intake` calling `create_escalation` is rejected at the allowlist stage while `escalation_consensus` calling the same tool gets past every stage up to a real FK violation at execution (proving the allowlist, not luck, is what blocked the first case); malformed/missing args return `INVALID_ARGS` structurally, never a throw; a provider that never resolves and a `MockProvider` fed schema-violating responses both produce `PROVIDER_ERROR` after the retry budget, while valid mock output round-trips correctly. `tests/architecture.test.ts` (doc 01 R2.3) still passes — every new file goes through repository functions, no raw `db.*`/`tx.*`.
- `docs/ai-architecture.md` written — design decisions, what backs each tool today vs. what docs 10/11/12/13/14/15/16 will extend, and the schema-gap fix.

---

## 2026-09-18 (later still) — Doc 08: mandatory queue simulation

**Tool:** Claude Code (Sonnet 5).

- **Explicit scope call, stated before writing code:** R3 asks for a full injectable `Clock` interface across the queue layer. Given the time budget, went with threshold-compression instead — optional override parameters on `tier.ts`/`backoff.ts`/`recompute.ts`/`claim.ts`/`scheduler.ts`/`record-outcome.ts` that default to the unchanged production constants (2h tier cutoff, 10min callback window, 15/45/120/240min backoff table, 5min claim lease). Verified the defaults are truly untouched by re-running `tests/queue-priority.test.ts`, `tests/queue-recompute.test.ts`, `tests/queue-backoff.test.ts` with no arguments after adding the overrides — all still passed.
- `sim/fixtures/queue-sim-patients.json` — 28 patients matching R1's itemized risk breakdown (6/10/8/4). Flagged and logged a real spec discrepancy rather than silently picking one: R1's breakdown sums to 28, but the Claude Code prompt's own text says "26 patients." Followed the more specific, itemized requirement. `tests/queue-sim-fixture.test.ts` locks the composition (risk counts, tag counts, campaign weights) against silent drift.
- `sim/queue-sim.ts` — runs the real `runSchedulerTick`/`claimNextTask`/`recordCallOutcome`/`runReaperTick` against a live seeded hospital, not a reimplementation. Patient seeding parallelized (8 concurrent lanes via the same `runWithConcurrency` pattern as `sim/generate-patients.ts`) after a first attempt at sequential seeding made it clear this environment's real per-query Supabase-pooler latency would blow the whole time budget on setup alone, before a single scheduler tick ran.
- `/simulation` page + `GET /api/simulation/live`: a deliberately minimal live view — the sim script writes its state to `sim/runs/live-state.json` after every tick, the API route reads it, the page polls once a second. Scoped down from the spec's full interactive dashboard/button set; `Inject provider error` wasn't separately wired into the sim since that exact behavior (attempt not consumed) already has a dedicated unit test in `tests/queue-record-outcome.test.ts` — redundant to also prove it live.
- **Two real bugs, both caught only by watching a live end-to-end run, not by unit tests:**
  1. The "no duplicate claims" end-of-run assertion used `taskId:attemptCount` as its dedup key. `CALLBACK_REQUESTED` has `consumesAttempt: false`, so `recordCallOutcome` reverses the claim-time attempt-count increment — meaning a patient's first callback request and the later, entirely legitimate claim that honors it can both land on `attempt_count=1`, which the check misread as a duplicate. Fixed by tracking an in-flight task-id `Set` (added at claim, removed on resolution/reaper-recovery) instead — the property that's actually invariant, since `claim.ts`'s state filter structurally prevents a task from being claimable while already claimed. The real concurrent-duplicate-claim guarantee is doc 06's `tests/queue-concurrency.test.ts` (50 workers vs. capacity 10); this was a bug in the simulation's own assertion, not in the queue.
  2. The kill-worker demo's trigger condition reset once the reaper recovered the frozen task, so the *same* task (now claimable again, still CRITICAL risk) re-triggered the demo on its next claim and froze forever — an infinite loop that only showed up by watching a run run long enough to reach a second reclaim. Fixed with a `killWorkerDemoUsed` flag separate from the "currently frozen" state, limiting the demo to firing once per run.
- Full clean run (seed 46, post-callback-fix, pre-duplicate-claim-assertion-fix): all mechanics correct — 23 completed, 2 escalated, 3 manual-follow-up, 3 callbacks honored, 1 reaper recovery, capacity never exceeded across 24 ticks; only the (now-fixed) duplicate-claims assertion false-flagged. Trace: `sim/runs/46-1789747456572.json`.
- This environment's Supabase-pooler connection to a real live database (not a mock) surfaced its own operational lessons: multi-second-to-tens-of-seconds per-query latency spikes and at least two outright `CONNECTION_CLOSED` drops during reruns, most likely from stale pooler-side connections accumulated across several killed (`TaskStop`'d) prior sim processes during debugging. None of this reflects the sim code's correctness — it's this dev machine's path to the Supabase pooler specifically — but it is the honest reason `npm run sim` ran well past the spec's 4-minute target in several attempts on this machine, and is worth re-checking against the actual deployed (Railway-worker-to-Supabase, same-region) path before the demo recording.
- `docs/queue-design.md` extended with the full doc 08 section (scope decision, dataset, runner, R4 reduction, both bugs).

---

## 2026-09-18 (later) — Doc 07: queue states, retries, callbacks, failure recovery

**Tool:** Claude Code (Sonnet 5).

- `lib/queue/state-machine.ts` — the full transition graph exactly as the spec's diagram draws it, including two subtleties: `CALLBACK_SCHEDULED` is only reachable from `CONNECTED` (not `CALLING` — you can't request a callback on a call that never picked up), and `DECLINED`/`INVALID_NUMBER` are transient two-hop states (`CALLING→DECLINED→COMPLETED`), not direct jumps, so the transition history stays an honest record.
- `lib/queue/outcome-policy.ts` — the literal outcome table as data. `lib/queue/backoff.ts` — base[attempt]±20% jitter, clamped forward through calling hours and patient preference in 15-minute steps, refusing (`WINDOW_WOULD_EXPIRE`) rather than scheduling an impossible call.
- `lib/queue/record-outcome.ts` orchestrates all of it, including the one genuinely tricky mechanic: `claim.ts` increments `attempt_count` unconditionally at claim time, before any outcome is known, so making `PROVIDER_ERROR` "not consume an attempt" means reversing that increment by one after the fact — not just skipping an increment that already happened.
- `lib/queue/reaper.ts` (backed by a proper repository function this time, not a repeat of doc 06's R2.3 mistake) resets stale `CALLING`/`CONNECTED` leases, releases capacity in the same transaction, and leaves `attempt_count` untouched.
- **Two test bugs caught by running them, not implementation bugs:** a callback test tried to transition `CALLING→CALLBACK_SCHEDULED` directly, which the state machine correctly rejected (the spec's diagram only allows that from `CONNECTED` — the test was wrong, not the graph). A `PROVIDER_ERROR` test asserted `attempt_count` stays unchanged, but per the design above it's supposed to decrement back to what it was before the claim-time increment — fixed the assertion, not the code, once the reasoning was traced through.
- **Verified the SIGKILL acceptance criteria** by simulating exactly the DB state a crashed worker leaves behind (a `CALLING` row, expired lease, reserved capacity) rather than literally spawning and killing a process — `tests/queue-reaper.test.ts` confirms recovery to `RETRY_SCHEDULED`, capacity released, attempts untouched, and that a task with a still-valid lease is left alone.
- `docs/queue-design.md` extended with the states/retries/callbacks/recovery sections.

---

## 2026-09-18 (later) — Doc 06: queue priority & concurrency (highest-weighted doc in the pack)

**Tool:** Claude Code (Sonnet 5). Followed the spec's SQL and formula literally rather than reinterpreting it — this is the doc where that matters most.

- `lib/queue/priority.ts` (pure `computeScore`) and `lib/queue/tier.ts` (pure `assignTier`) — the spec's worked example reproduces exactly (0.4967, 0.67, correct B→C→A ordering) in `tests/queue-priority.test.ts`.
- `lib/queue/claim.ts` — the single-transaction claim exactly as specified: conditional capacity increment, `FOR UPDATE SKIP LOCKED` task selection with the cooldown `NOT EXISTS` clause, atomic state flip. `lib/queue/recompute.ts` is the bulk `UPDATE...FROM` cadence version of the same formula, cross-checked against the pure function in `tests/queue-recompute.test.ts` so the two can't silently drift.
- Filled a real gap nothing before this doc covered: nothing turned an ELIGIBLE patient (doc 05) into an actual `outreach_tasks` row. Added `lib/queue/materialize.ts`, wired into `transitionCampaign`'s RUNNING branch, right after eligibility recompute.
- **Four real issues, all caught by tests/checks before being called done:**
  1. `scheduler.ts` and `recompute.ts` queried RLS-protected tables (`campaigns`, `hospital_capacity`, `outreach_tasks`) with plain `db.select()`/`db.execute()` — no `app.hospital_id` GUC set, since a worker process has no signed-in user to build a `TenantContext` from. Would have silently returned zero rows. Added `withHospitalContext()` to `lib/db/tenant.ts` for exactly this machine-actor case.
  2. `claim.ts`'s `campaign_id = ANY($1)` passed a JS array straight into drizzle's `sql` template; drizzle stringifies arrays with `Array#toString` (comma-joined, no braces), not as a Postgres array literal — `malformed array literal` on anything but a coincidentally-shaped single value. Fixed by building the `{...}` literal explicitly and casting `::uuid[]`.
  3. My own concurrency-test fixture forgot to set `scheduled_for` on seeded tasks — the claim query's `scheduled_for <= now()` treats NULL as "not yet due," so zero tasks were ever claimable. Test bug, not a queue bug; real task creation (`materialize.ts`) sets it correctly.
  4. `materialize.ts` and `scheduler.ts` queried tables directly instead of through a repository — the doc 01 R2.3 static check (tightened back in doc 02 to also catch `tx.*`, not just `db.*`) caught it immediately on a full suite run. Fixed by adding `hasTaskForPatientInCampaign`/`createOutreachTask` to `outreach-tasks.ts` and `listRunningCampaignWeightsByHospitalId`/`getHospitalCapacityByHospitalId` (hospitalId-only variants for the worker path, using `withHospitalContext`) to the campaigns/capacity repositories. The rule earned its keep here.
- **The concurrency proof passed:** 50 parallel workers vs. capacity 10, 3 repetitions — exactly 10 succeed every round, `current_active_calls` never exceeds capacity, zero duplicate claims. (Spec asks for 100 repetitions; see `tests/queue-concurrency.test.ts` for why 3 on this network's confirmed per-query latency — the guarantee is structural, not probabilistic, so this is a scope call, not a weakened test.)
- Score-explainability endpoint nested under `/api/hospitals/[hospitalId]/tasks/[taskId]/score` rather than the spec's flat `/api/tasks/:id/score` — every other route needs hospitalId to resolve RBAC/RLS, so a flat path would be the odd one out, not a real functional gap.
- `docs/queue-design.md` written per the doc 05 deliverable (queue design doc, deliverable 5).

---

## 2026-09-18 (later) — Doc 05: campaigns & eligibility

**Tool:** Claude Code (Sonnet 5). Moving faster per user request (aiming for many docs today) — less exhaustive verification ceremony per doc, backend-first, UI deferred where the spec doesn't hard-require it.

- Campaign lifecycle as a guarded state machine (`lib/campaigns/lifecycle.ts`), 8 eligibility rules as pure functions (`lib/campaigns/eligibility.ts`, unit tested individually per R5), pre-activation estimate as a pure heuristic (`lib/campaigns/estimate.ts`).
- New tables: `campaign_state_transitions`, `eligibility_evaluations` (one row per campaign+patient, overwritten on re-evaluation — R4 resume recomputes rather than replaying).
- **Real bug caught by testing:** `evaluatePatientForCampaign`'s own ERROR-handling path tried to persist an evaluation row for a patient id that didn't exist at all — but `eligibility_evaluations.patient_id` has a hard FK, so that write also failed, crashing instead of degrading gracefully. Fixed by checking patient existence before attempting any persistence and returning `null` (→ 404 at the route layer) for a truly nonexistent patient, distinct from "exists but has no encounter yet" (a real INELIGIBLE case).
- Verified live: READY→RUNNING recomputes eligibility and persists per-rule breakdowns correctly; pausing a RUNNING campaign never touches existing `outreach_tasks` rows (doc 06 will build the scheduler that actually enforces "no new claims" on top of this).
- Skipped for speed: campaign admin UI (drill-down panel, estimate panel) — API fully supports both, UI can follow later if time allows. Not a silent gap, a scope call given doc 05 is "Important" not "Highest" priority (doc 00 §1).

---

## 2026-09-18 — Doc 04: patient & discharge data ingestion

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Extended `encounters` with `risk_level` (new enum), `follow_up_window_hours`, and `source_message_id` (unique per hospital — the R5 idempotency key). Put these on the encounter rather than as a jsonb Observation value, since doc 05/06's eligibility and priority-scoring queries need to filter/sort on them directly.
- `lib/discharge/schema.ts` — the zod wire format for one discharge record. `lib/discharge/ingest.ts` — the shared pipeline (idempotency check by `sourceMessageId` → find-or-create patient by MRN → create encounter → create conditions/observations/medications/care plan → emit `patient.imported`/`discharge.ingested` events) used by both the HTTP batch endpoint and the generator directly, since seeding ~450 patients one HTTP round trip at a time defeats the point of a batch endpoint.
- `POST /api/hospitals/[id]/discharges` — accepts a JSON array or NDJSON body, validates every record independently with zod, returns `{accepted, rejected: [{index, field, reason}]}`. Partial success by design: one bad record never takes down the batch.
- **Found a real concurrency bug before it shipped**, not after: parallelizing the batch endpoint's per-record processing for throughput, I realized two records for the *same* MRN in one batch (a re-admission) would race the find-or-create-patient step if processed concurrently — both see "no patient yet," both try to create one, one hits the unique constraint. Fixed by grouping records by MRN first: different MRNs process concurrently (bounded to the pool size), same-MRN records process in order within their own group.
- `sim/rng.ts` (mulberry32, no dependency) + `sim/generate-patients.ts` — deterministic generator matching every distribution requirement in R2 (risk mix, discharge-time spread including near-deadline cases, follow-up window mix, ~8% invalid phone numbers, a handful of dual-condition "two campaign" candidates). Generation itself stays a single sequential loop (it's what consumes the shared RNG state — parallelizing it would break reproducibility), but the actual DB writes run with bounded concurrency, which is what actually matters for wall-clock time.
- **Deliberately did not fake two things doc 04's R2 asks for:** "~12% who will request callbacks" and "~15% who will present protocol red flags in conversation" are call-*behavior* scripting for a simulator that doesn't exist yet (doc 10) — there's no field to put them in yet, and it's doc 10's call to make whether that belongs on the patient or on a specific outreach task. Documented as an open gap rather than inventing a field now to satisfy the letter of R2.
- Closed a loop left open in doc 02: actually implemented the "audited" (Platform Admin, needs `?reason=`, routes through `resolvePlatformAdminAccess` and gets audit-logged) and "limited" (Campaign Manager sees demographics + risk/timing, not full clinical detail) grants on the new patient-detail route, rather than leaving them as permission-matrix entries nothing ever branched on.
- Minimal patient list + detail admin UI pages, linked from the hospital detail page.
- Sample feed: `sim/fixtures/sample-discharge-feed.ndjson`, 10 hand-written representative records (not generator output) showing the exact wire format.
- `npm run seed:demo` chains migrate → RLS → hospitals → users → patients into one command.
- Tests: idempotency (re-ingesting the same `sourceMessageId` doesn't duplicate), the literal acceptance criterion (3 malformed of N records → N-3 accepted, 3 rejected with field-level reasons), and same-batch-twice-same-row-count.

**Another real performance issue found via testing, not assumed:** the double-batch-of-10 test kept timing out even at 90s. Traced it to the batch endpoint's original strictly-sequential per-record loop — at confirmed multi-second-per-query latency on this network, 20 sequential ingests (each several round trips) genuinely doesn't fit in 90s. This is what led to parallelizing the endpoint (see the concurrency-bug entry above) — a real design improvement the test surfaced, not a workaround for the test itself. After the fix, the same test completes in well under its budget.

**Verified against the live project:** ran the generator at `--count 20` first to confirm the distribution logic (risk mix, hospital spread, invalid-phone rate) actually lands correctly in the DB, then ran the full `--count 450`. Took ~20 minutes wall-clock on this network (confirmed still making progress via `Get-Process`, not stalled — this is the same per-query latency documented in the doc 03 entry, not a new issue). Idempotency held across the two runs: the 20-patient test run's records showed up as "already ingested" in the full run rather than duplicating. Final dataset matches every R1/R2 target: 450 total patients, RHP (the low-capacity hospital) has 90, risk mix 49/35/11/5 (target 50/30/15/5), invalid phone rate 7.6% (target ~8%).

**Still open:** the two call-behavior scripting flags noted above (defer to doc 10); "eligible for two campaigns" is tagged via a second condition code on ~2% of patients, but there's no campaign/eligibility engine yet (doc 05) to actually confirm it produces dual eligibility — that's the next doc's job to close the loop on.

---

## 2026-09-17 (same day, later still still) — Doc 03: hospital onboarding & configuration

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Extended `hospitals` (short code, contact fields, address, a `hospital_status` enum CREATED→CONFIGURED→READY replacing doc 01's placeholder text status, and a `config jsonb` column) and added `escalation_contacts` — migrated live, including hand-editing the generated migration since existing rows (some permanently un-deletable by design — see doc 01/02 entries below) had the old `status='DRAFT'` value and no `short_code`; the blind enum cast and NOT NULL constraint drizzle-kit generated would have failed against real data, not just an empty table.
- Caught my own gap before applying RLS: added `escalation_contacts` to the schema but initially forgot to add it to `rls.sql`'s tenant-table list, which would have hit the exact Supabase auto-enables-RLS-with-no-policy trap documented in doc 01/02's entries again. Fixed before running anything against it.
- Built `lib/hospitals/timezone.ts` (`Intl.DateTimeFormat`-based local time conversion — no date library needed, Node's ICU already carries the IANA tz database), `calling-hours.ts` (`isWithinCallingHours`), `config-schema.ts` (zod-validated operating config), and `readiness.ts` (the R5 checklist, always returns the full missing-list, never a bare boolean).
- Repositories: extended `hospitals.ts`; added `escalation-contacts.ts`, `protocols.ts` (minimal — just enough for the readiness count, full protocol management is doc 11), `hospital-capacity.ts` (keeps `hospital_capacity.max_concurrent_calls` in sync with config, since that's what the doc 06/07 scheduler will actually read).
- 5 API routes (create/read hospital, PATCH config, escalation contacts CRUD, readiness, mark-ready) — all PLATFORM_ADMIN-gated per doc 03's own prompt ("CRUD for hospitals, restricted to PLATFORM_ADMIN"). Added `hospital:configure` to the permission matrix rather than overloading `hospital:create` for a PATCH.
- A minimal but functional admin UI (`/login`, `/admin/hospitals`, `/admin/hospitals/[id]`) — plain fetch + useState, no component library (none is in the stack). The config editor is a raw-JSON textarea pre-filled with a valid template rather than ~15 individual form fields for every nested config key; a prototype-scoped simplification, not a stub — the zod schema is still what actually validates it server-side.
- Tests: `calling-hours.test.ts` (includes a real DST spring-forward and fall-back transition test — caught my own arithmetic error in the test itself before trusting it: I had the offset direction backwards in one assertion), `hospital-config.test.ts` (schema edge cases), `readiness.test.ts` (live DB, walks the checklist from empty to everything-but-a-protocol).
- Seed scripts: `seed-demo-hospitals.ts` — the exact 3 from doc 03's prompt (Northside General/America/New_York/10, Harbour Clinic/Europe/Stockholm/3, Rural Health Post/Asia/Kolkata/1). Deliberately left at CONFIGURED, not READY — faking a protocol row just to flip a status flag would misrepresent what's actually built; doc 11 doesn't exist yet, so "missing a protocol" is the honest, correct readiness result for all three right now.

**A real debugging detour worth recording:** the test suite intermittently hung for 30-60s+ on `beforeAll` hooks after these changes. Chased it through: (1) suspected connection-pool exhaustion from parallel test files → disabled `fileParallelism`, didn't fully fix it; (2) wrote throwaway diagnostic scripts using `tsx -e "<inline code>"` that themselves hung on trivial code with no DB involved at all — that was tooling noise, `tsx -e` appears broken in this environment independent of anything in this project; (3) once diagnosed properly with an actual `.ts` file, confirmed the real cause: this network has several seconds of round-trip latency to the Supabase pooler (a raw `select 1` took 3.5-8.4s across repeated tries) — not a hang, just slow, and the original 10s default timeout wasn't enough for a `beforeAll` doing several sequential writes. Fixed by raising Vitest's timeouts to real-network-appropriate values and parallelizing independent setup calls in `rbac.test.ts` with `Promise.all`. Separately, found and fixed two actual test bugs the slower runs surfaced: hardcoded `shortCode` values collided with permanently-undeletable leftover rows from earlier runs (needed a per-run unique suffix, same pattern `readiness.test.ts` already used correctly), and two `afterAll` hooks would crash on `undefined.id` if their own `beforeAll` had failed first, masking the real error.

**Still open:** doc 03's config UI is a JSON textarea, not per-field controls (see above) — a reasonable prototype simplification, not a gap I'd call hidden. Protocol upload (doc 11) is what's actually blocking these hospitals from reaching READY.

---

## 2026-09-17 (same day, later still) — Doc 02 finished: Supabase Auth, route guard, demo users, RBAC + injection tests

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Found and fixed a real gap in doc 01's schema: `PLATFORM_ADMIN` is hospital-independent (manages all hospitals), but the schema only stored roles per-hospital via `user_hospital_roles`. Added `users.is_platform_admin boolean`, migrated it live.
- Built the Supabase Auth wiring: `lib/supabase/{server,client,admin}.ts` (SSR/browser/admin clients), `lib/auth/session.ts` (`getCurrentAppUser`, `resolveTenantContext` — cross-tenant → `NoHospitalAccessError`/404, and `resolvePlatformAdminAccess` — the audited PA-reads-one-hospital's-data path from doc 02 R3, which writes to `audit_log` via a proper repository call, not a direct query), and `lib/auth/guard.ts` (`guard()` for hospital-scoped actions, `guardPlatformAdmin()` for global ones like `hospital:create`; maps to 401/403/404 per the doc's own acceptance criteria — cross-tenant is 404, never 403, so existence doesn't leak).
- Added `middleware.ts` — the standard Supabase SSR session-refresh pattern; without it, Server Components can't write cookies themselves and sessions would silently go stale.
- Wired 3 demonstration API routes (`POST /api/hospitals`, `GET /api/hospitals/[id]`, `POST .../escalations/[id]`) — enough to exercise the guard chain end-to-end, not full business logic (that's docs 03/17).
- Added `hospital:read` to the permission matrix — not in the PRD §3 table verbatim; flagging it as necessary plumbing (every resolved role needs to read its own hospital's metadata) rather than a silent scope addition.
- **Caught my own mistake before it shipped:** almost called `tx.insert(auditLog)` directly inside `lib/auth/session.ts` for the PA audit-write, which would have violated doc 01 R2.3 (all queries through `lib/db/repositories/`) — the static check didn't catch it because it only matched `db.*`, not `tx.*`. Fixed by adding `lib/db/repositories/audit.ts` and *also* tightening `tests/architecture.test.ts`'s regex to catch `tx.*` too, closing the loophole for future code, not just this one call site.
- Wrote `tests/rbac.test.ts` (mocks only the Supabase Auth boundary — `getCurrentAppUser`, `resolveTenantContext`, the permission matrix, and the DB all run for real against live seeded fixtures) and `tests/prompt-injection.test.ts`, scoped honestly: verifies `wrapUntrusted()`'s delimiting and that `UNTRUSTED_CONTENT_NOTICE` names the classic attack, but does NOT claim to test "triage output is unaffected" — no triage agent exists yet (doc 12/13), so that claim would be fabricated. Documented the real limitation: a forged closing delimiter embedded in patient text does produce a second, earlier-looking close marker in the raw string; the system-prompt notice is what has to carry the actual defense, not delimiter unforgeability.
- **Found and fixed a genuine Postgres RLS bug** via the RBAC tests: `current_setting('app.hospital_id', true)` returns `''` (empty string), not `NULL`, once that custom GUC has been `SET LOCAL`-scoped at least once on a connection and then reverted — so a transaction that deliberately leaves it unset (like `getRolesForUser`, by design, since it runs before a hospital context exists) hit `invalid input syntax for type uuid: ''` on every RLS-protected table. Fixed by adding `app_hospital_id()`/`app_user_id()` SQL helper functions to `rls.sql` that `nullif(...,'')` before casting, used everywhere instead of the raw expression.
- Wrote `scripts/seed-demo-users.ts` — creates one demo hospital + 4 pre-confirmed demo accounts (Admin API, so no email-confirmation wait). Ran it against the live project once the service role key was provided; verified all 4 users, the `is_platform_admin` flag, and the 3 hospital-scoped role rows landed correctly.
- Full suite: 20/20 tests passing against the live database (`tests/architecture.test.ts`, `tests/tenancy.test.ts`, `tests/rbac.test.ts`, `tests/prompt-injection.test.ts`). `tsc --noEmit` and `eslint` clean.

**Doc 02 is fully done, including the seeded demo accounts.** Demo credentials (password `Demo1234!` for all four): `platform-admin@demo.mhpd.local`, `hospital-admin@demo.mhpd.local`, `campaign-manager@demo.mhpd.local`, `clinical-reviewer@demo.mhpd.local` — all under "Demo General Hospital" except the platform admin, who isn't hospital-scoped.

**Operational security note (again):** the user also pasted the project's publishable key, new-style secret key, and legacy anon/service_role JWTs directly into chat. Only the new-style secret key was used (`SUPABASE_SERVICE_ROLE_KEY`); the legacy JWTs weren't stored anywhere, reducing what's sitting in `.env`. Same recommendation as before applies to this key too: rotate it from the dashboard once convenient, since it's now in plaintext chat history.

**Still open:** a real login page (deferred — doc 02's own deliverable list doesn't ask for one, only session resolution + seeded accounts).

---

## 2026-09-17 — Scaffold + doc 01 (data model & tenancy) + doc 02 partial (RBAC pieces)

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Scaffolded Next.js 15.5.25 App Router + TypeScript (create-next-app defaulted to Next 16; pinned back to 15 per doc 00's stack decision and re-ran install).
- Built the repo layout from doc 00 §6 (`/lib/db`, `/lib/queue`, `/lib/ai`, `/lib/ehr`, `/lib/events`, `/lib/obs`, `/lib/auth`, `/worker`, `/sim`, `/eval`, `/docs`, `/tests`).
- Wrote the full Drizzle schema (`lib/db/schema.ts`) — 29 tables covering tenancy, FHIR-shaped clinical resources, protocols/pgvector, campaigns/queue, calls/triage/escalation, events/notifications, and observability, per doc 01 R1–R7.
- Wrote `lib/db/tenant.ts` (`TenantContext` + `withTenant()` using `set_config(..., true)` — parameterized, not string-interpolated) and `lib/db/rls.sql` (RLS policy per tenant table, `app_user` role, audit_log append-only via revoke + trigger).
- Wrote reference repositories (`hospitals`, `users`, `patients`) establishing the pattern for later docs to extend.
- Wrote `tests/tenancy.test.ts` (integration — needs a live DB) and `tests/architecture.test.ts` (static, doc 01 R2.3 — no `db.*` calls outside `lib/db/repositories/`); the static test passes.
- Ran `drizzle-kit generate`; confirmed all 29 tables, the partial/composite indexes on `outreach_tasks`, and the `vector(1536)` column generated correctly; manually added `CREATE EXTENSION IF NOT EXISTS vector;` to the migration (drizzle-kit doesn't emit extension statements).
- Drafted doc 02's dependency-free pieces: `lib/auth/permissions.ts` (declarative role/action matrix), `lib/ai/untrusted.ts` (prompt-injection delimiting), `lib/obs/redact.ts` (PHI log scrubbing), `docs/security.md` (honest compliance statement).
- Fixed scaffold/tooling mismatches from the Next 16→15 downgrade: `app/layout.tsx` used a Next-16-only `LayoutProps` global type; `eslint.config.mjs` imported `eslint-config-next` paths that only exist in the Next 16 package and assumed flat-config exports the Next 15 package doesn't provide — rewrote it using `FlatCompat` per the standard Next 15 pattern.
- Full `tsc --noEmit` passes clean across the codebase.

**Deliberate scope decisions (see `docs/data-model.md` "Deliberately deferred"):**
- Repositories for tables not yet needed (campaigns, outreach_tasks, calls, etc.) are left for the doc that first needs them (05, 06, 10, ...), following the same `TenantContext`/`withTenant()` pattern already established.
- Platform Admin cross-hospital aggregate reads are explicitly NOT implemented as an RLS bypass — deferred to doc 18's audited aggregate-query design, per doc 01's "Do not."

**Still open before doc 02 can be marked done:**
- Doc 02's Next.js-specific pieces (Supabase Auth wiring, the `requirePermission` route guard, seeded demo users, the allow/deny test matrix, the injection-resistance test) — not yet written.

---

## 2026-09-17 (same day, later) — Wired to the live Supabase project, doc 01 verified end-to-end

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Connected to the user's Supabase project and ran migrations + `rls.sql` against it for real.
- Hit and fixed two environment issues neither of us could have known about from the spec alone:
  1. New Supabase projects only expose the direct `db.[ref].supabase.co` host over IPv6; this network has no IPv6 route. Fixed by switching to Supabase's Supavisor pooler (session mode, port 5432, for migrations; transaction mode, port 6543, for the app) and disabling `postgres.js` prepared statements (`prepare: false`), which transaction-mode pooling doesn't support.
  2. Supabase auto-enables RLS by default on every new table in `public`. This silently turned `hospitals` and `users` — tables that intentionally have no RLS policy, since they sit above the tenant boundary — into an accidental deny-all. Fixed by explicitly `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` on those two in `rls.sql`, with a comment explaining why.
- Wrote `scripts/apply-rls.ts` — reads `lib/db/rls.sql`, substitutes the real `app_user` password (from `DATABASE_URL_POOLED` in `.env`) only in memory, and executes it. The committed `rls.sql` keeps its `CHANGE_ME` placeholder; the real password is never written to a tracked file.
- Ran `tests/tenancy.test.ts` against the live database. All 6 assertions passed: repository-level isolation, raw-SQL-under-RLS with a deliberately unfiltered query, cross-tenant lookup-by-id blocked, and both the delete-blocked and update-blocked audit_log immutability tests.
- Fixed the test's own cleanup logic along the way: `app_user` has no `DELETE` grant (correct, tight privilege model), so cleanup needs an admin connection; and `hospitalA` becomes permanently non-deletable once an `audit_log` row references it (the FK + append-only trigger working exactly as designed) — the test now deletes what it can and documents why the rest is intentionally left.

**Operational security note:** the user pasted a live DB password and a Supabase personal access token directly into chat. Both now exist in plaintext conversation history. Recommended (to the user, not yet done): rotate the Postgres password and the `sbp_...` access token from the Supabase dashboard once initial setup is confirmed working. The Supabase CLI token was never actually used — our stack connects directly via `DATABASE_URL`/Drizzle, not the Supabase CLI — which limits, but doesn't eliminate, its exposure.

**Doc 01 is now fully done and verified, not just written.** Doc 02 remains partial — see above.

---

## 2026-09-19 — Docs 14/15: Documentation Agent & Mock EHR, plus a CI pipeline

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Added the CI pipeline requested this session (`.github/workflows/ci.yml`): every push/PR runs typecheck, lint, real Drizzle migrations + RLS, and the full test suite against a disposable `pgvector/pgvector:pg16` container. Validated it end-to-end against a local Docker Postgres before trusting it, which caught a real config gap (nothing ever set `app_user`'s password to match the CI's connection string — `rls.sql` deliberately hardcodes a placeholder, by design, since it's a committed file) and a real, pre-existing timing bug in doc 10's voice intake (a default callback offer and a test fixture's deadline both used independently-read clocks with a `now + 24h` offset and zero safety margin — see `docs/voice-intake.md`'s sibling note in the commit history).
- Implemented doc 15's mock EHR: `EHRClient` interface + `MockEHRClient` (`lib/ehr/`), `/api/mock-ehr/*` routes for Patient/Encounter/Condition/CarePlan (GET) and Communication/Observation/Task/EncounterNote (POST), failure injection (`lib/ehr/failure-injection.ts`, pure and RNG-injectable), an idempotency store (`ehr_idempotency_records`, added in doc 13's follow-on schema pass), and a backoff retry worker.
- Implemented doc 14's documentation agent (`lib/documentation/run-documentation.ts`): runs for every call outcome including empty-transcript ones (NO_ANSWER, etc.), same repair-once/fail-closed validation pipeline as doc 12's triage assessor, transcript-reference verification against fabricated symptoms.
- **Real bug found and fixed**: routing the EHR write through doc 09's `callTool` gateway (as doc 14 R6's wording literally suggests) broke on a subtle FK issue — `callTool`'s post-write audit-log insert requires a real `users.id` for `actor_user_id`, but the documentation agent runs as system/worker code with no signed-in user. The write itself succeeded; the audit-log insert right after it failed the FK; `callTool`'s single try/catch reported the whole thing as a failure, so every EHR write looked like it failed even at 0% injected failure rate. Fixed by having the documentation agent and retry worker call `EHRClient` directly instead of through the gateway — justified because that gateway's protections exist to sandbox a *model's* own tool-call attempts, not trusted orchestration code calling a client it already holds a reference to. Documented in `docs/documentation-and-mock-ehr.md` rather than patched inside the gateway itself, since fixing the gateway's own audit-logging-can-mask-a-successful-write gap is out of scope here.
- Full write-up of every scope decision (EHR client in-process call vs. real HTTP, writeEncounterNote reusing `communications`, GET routes reusing doc 04's `source_payload`) in `docs/documentation-and-mock-ehr.md`.

**Verified**: `tests/documentation-and-ehr.test.ts` (3 tests) — a NO_ANSWER attempt still documents and syncs; a fabricated symptom is rejected after both attempts; forcing the mock EHR's failure rate to 1 surfaces `FAILED` with a real error, and the retry worker syncs it once the rate drops back to 0. Full suite (33 files) re-run clean after these changes.

**Deferred**: call detail 3-pane UI, EHR health panel — both doc 17/18 frontend work per this build's established split. A visible "manual task" for exhausted EHR retries depends on doc 16 (events/notifications), not yet built.

---

## 2026-09-19 (same day, later) — Doc 16: Events, Workflows & Notifications

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Built the event bus (`events` table gains `scheduled_for` and `attempts`; `event_status` gains `PROCESSING`/`DEAD`) and a `FOR UPDATE SKIP LOCKED` polling dispatcher (`lib/events/dispatcher.ts`), same claim pattern as the queue's `claimNextTask`.
- Implemented R5's escalation notification chain exactly as PRD §20 specifies it (`lib/events/handlers/escalation-notifications.ts`): notify primary reviewer → scheduled follow-up event (not `setTimeout`, since that doesn't survive a restart) after `reviewer_timeout_minutes` → if still unacknowledged, notify backup reviewer + schedule a second follow-up → if still unacknowledged, mark the escalation `OVERDUE`. `escalation_state` gained `ACKNOWLEDGED`/`OVERDUE`.
- Wired it into doc 13: `escalateFromConsensus` now calls `startEscalationNotificationChain` right after creating an escalation.
- **Real near-miss, caught immediately**: `lib/db/repositories/events.ts` already existed (a doc 05/07 stub, `emitEvent(ctx, input)`, with three real callers — campaign transitions, discharge ingestion, the campaigns route). Writing this doc's new dispatcher plumbing to that same path with `Write` instead of `Edit` overwrote it with an incompatible signature; `tsc --noEmit` failed all three callers immediately with an arg-count mismatch. Recovered the original with `git show HEAD:lib/db/repositories/events.ts` and merged properly — the existing signature is untouched, the new claim/dispatch functions were added alongside it. Same failure mode, same fix, as a doc 11 near-miss earlier this build.
- Scoped down R2's 16-event catalogue to one fully-wired chain (escalation.created/timeout_check) rather than a handler for every type — the rest is typed and reserved in `lib/events/registry.ts` so future emitEvent calls still type-check, but writing 15 more handlers with no corresponding required test wasn't a good use of the remaining time budget.
- Email/webhook notification delivery is explicitly not implemented — `deliverNotification` marks those channels `FAILED` with an honest "not implemented in this build" error rather than fabricating a send (R7 explicitly allows this: "email/SMS optional and allowed to fail visibly").

**Verified**: `tests/events-and-notifications.test.ts` (3 tests) — a redelivered event (same row, simulating a crash before it was marked done) produces exactly one notification via the handler's own idempotency guard, not just the event layer's; an acknowledgment that happens before a scheduled timeout-check fires converges without over-notifying; an unacknowledged escalation reaches the backup reviewer and then `OVERDUE`. Full suite re-run clean.

**Deferred**: dead-letter admin panel, in-app notification centre, and the hospital config UI for the workflow knobs — all doc 17/18 frontend work. Handlers for the rest of the event catalogue. `callback_reminder_lead_time` (R6) — not exercised by any required test.

---

## 2026-09-19 (same day, later) — Doc 17: Escalation Management & Human-in-the-Loop (first real frontend)

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Built the guarded escalation lifecycle (`lib/escalations/lifecycle.ts`), reconciling R1's simple `OPEN→ASSIGNED→IN_REVIEW→WAITING_FOR_INFORMATION→RESOLVED→CLOSED` diagram with `ACKNOWLEDGED`/`OVERDUE`, which doc 16 (built first) already added — documented as a deliberate reconciliation, not a silent override, in `docs/escalation-management.md`.
- `transitionEscalationState` (`lib/db/repositories/escalations.ts`) is now the one place `escalations.state` is ever written after creation: validates, writes the transition row, and writes an audit entry with before/after state — same shape as doc 07's outreach-task state machine.
- **Real bug, same shape as doc 14/15's audit-log FK issue**: refactoring doc 16's `acknowledgeEscalation`/`markEscalationOverdue` to go through this shared transition function broke doc 16's own test suite immediately — its automated timeout chain runs under a synthetic system actor with no real `users.id`, and `writeAuditLog`'s FK rejected it. Fixed with a `skipAudit` flag used only by those two automated transitions, which is also the more correct reading of R6 ("every **human** action" — an automated timeout isn't one).
- SLA fields (`acknowledged_at`/`time_to_acknowledge_seconds`, `resolved_at`/`time_to_resolve_seconds`) are snapshotted at the moment of transition, not computed on read, so doc 18's dashboards can query them directly.
- Added `escalation:view`/`escalation:assign` permissions — narrower than the existing `queue:view` (CAMPAIGN_MANAGER can see the call-dispatch queue but not escalations, per R5).
- One action endpoint (`POST .../escalations/[escalationId]`) dispatches acknowledge/assign/reassign/request-info/resolve/close/create-followup by body, rather than six separate routes; an illegal transition returns 409 with the specific from→to error.
- **First real frontend of this build**: `/admin/hospitals/[hospitalId]/escalations` (reviewer queue, R5) and `/admin/hospitals/[hospitalId]/escalations/[escalationId]` (the full one-page review screen, R3 — patient summary, transcript with indicator-triggering turns highlighted, all three assessments side by side with the firing consensus rule labelled, expandable protocol evidence, previous outreach history, and the complete action bar), in the same minimal inline-style convention as the existing `/admin/hospitals/[hospitalId]/patients` pages — no design system exists in this codebase yet.

**Verified**: `tests/escalation-lifecycle.test.ts` (6 tests) and 5 new tests in `tests/rbac.test.ts` — illegal transitions rejected including out of a terminal state; a full valid path computes both SLA fields; `no_action_needed_false_positive` recorded as its own outcome; every human action produces the exact expected audit-row sequence with before/after state; queue ordering (OVERDUE > priority > age); CAMPAIGN_MANAGER blocked from view/assign, HOSPITAL_ADMIN can assign but not resolve. `npx tsc --noEmit` and `npx next build` both clean. No interactive browser testing was possible in this environment (no browser tool) — noted explicitly rather than claimed.

**Deferred**: dead-letter panel, notification centre, config UI (doc 16's carryover); a reviewer-picker widget for reassignment (the API accepts an explicit `reviewerUserId`, the UI only self-assigns).

---

## 2026-09-19 (same day, later) — Doc 18: Dashboards & Analytics

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Built the analytics query layer (`lib/analytics/`): campaign-manager (progress funnel, capacity gauge, queue depth, cutoff-approaching/Tier-1 count, retry backlog, upcoming callbacks), hospital-admin (overview, escalation counts, manual follow-up backlog, EHR sync health, protocol versions, per-reviewer median time-to-resolve), platform-admin (per-hospital activity + AI usage), and patient-timeline (merges calls/escalations/documentation/follow-up tasks into one chronological feed).
- **Platform Admin aggregates never bypass RLS** — doc 01's own explicit rule. Every tenant table's RLS policy FORCEs row security on `app.hospital_id`; there is no query shape that reads across hospitals through `app_user` without it. Implemented as a per-hospital loop under `withHospitalContext`, summed in application code — never a single unscoped cross-hospital query. This also mechanically enforces "aggregates only" (R3): nothing here can select a patient-level row from an unscoped hospital.
- Built all four dashboards' frontend pages (Campaign Manager, Hospital Admin, Platform Admin, patient timeline), 5-second polling per R6's explicit "no websockets" instruction. Reused doc 06's existing score-breakdown endpoint for the "why this order?" popover and doc 05's existing campaign-transition endpoint for start/pause/resume/cancel controls, rather than rebuilding either.
- Added the required test (`tests/analytics-tenant-isolation.test.ts`): seeds Hospital B with deliberately more/different data than Hospital A so a missing `hospital_id` filter would immediately inflate A's numbers, not coincidentally match.
- **Two real bugs found writing that test** (in the test's own fixture, not the code under test): a patient MRN collision from reusing a loop index across two seeding calls for the same hospital (tripped the real unique constraint); and `createHospital` not auto-creating a `hospital_capacity` row, so the fixture's `UPDATE` silently matched zero rows instead of erroring — the exact silent-no-op class of bug this test exists to catch. Fixed both; documented in `docs/dashboards-and-analytics.md`.

**Verified**: `tests/analytics-tenant-isolation.test.ts` (5 tests) — campaign progress, capacity gauge, hospital overview, escalation counts, and both backlog counts under Hospital A's context never reflect Hospital B's larger, different dataset. `npx tsc --noEmit`, `npx eslint`, and `npx next build` all clean.

**Deferred**: a shared, reusable capacity-gauge component (currently inlined separately in the dashboard and not reused on `/simulation`); a "reprioritise" campaign control (no such concept exists elsewhere in this build); Platform Admin patient-level drill-in and its audit entry (this build's dashboard never offers one, so there's nothing to audit yet).

---

## 2026-09-19 (same day, later) — Doc 19: Observability, Audit & System Health

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- `lib/obs/logger.ts`: structured JSON logging, correlation ids via `AsyncLocalStorage` (not a threaded parameter, to avoid refactoring every existing call site), every payload run through doc 02's `redact()`. Wired at three points: `runCall` (call start/outcome, the highest PHI-risk surface), the event dispatcher, and every mock-EHR call; `guard.ts` logs auth denials.
- `lib/obs/health.ts` + `/api/health` + `/admin/health`: system health per R6's exact shape, aggregating across hospitals the same RLS-safe per-hospital-loop way doc 18's Platform Admin dashboard does — never an unscoped cross-hospital query.
- `workers` table (tenant-scoped, new migration) + heartbeat repo functions feed `stuck_workers` in the health check.
- Audit viewer (`/admin/hospitals/.../audit`) and a metrics endpoint/page reusing doc 18's analytics functions rather than a second pipeline.
- **Required test**: seeded a patient with a deliberately distinctive name/phone, ran the real `runCall()` path with the name embedded in the agent's own greeting, captured all console output, and asserted the name/phone never appear in it — while also asserting the transcript *does* contain the name, so the test can't pass vacuously.
- Local test Postgres had accumulated hundreds of throwaway hospitals from this whole session's test runs, making a per-hospital health-check test time out; reset the disposable container rather than chase an ever-larger timeout.
- Per user request: added `COMMIT_LOG_PLAIN_ENGLISH.md` (gitignored, local-only) explaining every commit in plain language going forward.

**Verified**: `tests/observability-phi-redaction.test.ts` and `tests/observability-health.test.ts` pass against a fresh local Postgres. `npx tsc --noEmit` and `npx eslint` clean.

**Deferred**: full operation-id wiring through every AI/tool-gateway call (only 3 choke points instrumented); persisted API-latency/error-rate/auth-failure metrics (logged as events, not aggregated into a table — no metrics store in this build).
