# Escalation Consensus & Clinical Safety (Doc 13)

## The three assessors

`claude-triage-v1` (LLM, protocol-first), `gpt-triage-v1` (LLM, symptom-first, different vendor — doc 09's prompts deliberately frame these two differently, not just route them to different providers), and `rule-engine-v1` (deterministic, no LLM). All three emit the same `TriageResult` shape (`lib/ai/schemas/triage.ts`, doc 12 R1's schema, built here as a prerequisite since doc 13 consumes it directly).

**The rule engine is not a fallback.** It's the only assessor whose errors are uncorrelated with the other two's. Two LLMs agreeing on a wrong answer is the exact failure PRD §16 defends against; a deterministic keyword/condition matcher over the protocol's own red flags can't hallucinate and can't be prompt-injected, so its disagreement with the LLMs is informative in a way LLM-vs-LLM disagreement isn't.

`lib/ai/assessors/rule-engine.ts` (`runRuleEngine`) is deliberately pure and DB-free: it takes the protocol's red flags as a plain argument rather than loading them itself. Doc 11 (protocols/retrieval) owns fetching real structured red-flag content from a protocol; when it lands, it feeds this same function real data with zero changes to the function itself. Confidence is always `1.0` — a deterministic string search is never uncertain about whether it found a match, matched or not.

## Consensus algorithm (`lib/ai/consensus.ts`)

Implemented exactly as specified, in order, first match wins:

1. Any assessor `urgent` → ESCALATE, HIGH
2. Rule engine matches a high-severity red flag, regardless of LLM opinions → ESCALATE, HIGH
3. Any assessor `uncertain` → ESCALATE, MEDIUM
4. Any assessor failed → ESCALATE, MEDIUM, `ASSESSOR_FAILURE`
5. `max(severity_rank) - min(severity_rank) >= 2` → ESCALATE, MEDIUM, `MATERIAL_DISAGREEMENT`
6. Majority `concerning` → ESCALATE, LOW
7. Unanimous `routine`, all confidences ≥ 0.7, nothing missing → **the only no-escalation branch**
8. Default → ESCALATE, LOW

**Rule 8 is the point.** Any case this logic doesn't explicitly recognise as safe is treated as needing a human.

**A genuine spec observation, not a bug:** rule 5 is structurally unreachable as ordered. `severity_rank` is `{routine:0, concerning:1, uncertain:2, urgent:3}`, but any `urgent` classification already fires rule 1, and any `uncertain` already fires rule 3 — both strictly before rule 5 is evaluated. By the time execution reaches rule 5, every completed assessor's classification is restricted to `{routine, concerning}`, whose rank gap maxes at 1, never ≥ 2. Implemented exactly as specified anyway — "implement exactly this" is the instruction, and reordering to make rule 5 reachable would be a silent, undocumented deviation. Documented in both `lib/ai/consensus.ts` and `tests/consensus.test.ts` rather than fixed quietly.

**Verified** (`tests/consensus.test.ts`, `tests/rule-engine.test.ts`): one test per rule including the two rule-7 boundary cases (a confidence below 0.7, and non-empty `missing_information`, both correctly fall through to rule 8 rather than qualifying for no-escalation); the acceptance-criteria case — both LLMs say `routine`, the rule engine's *indicators* carry a high-severity match even though its own `classification` field doesn't say `urgent` — still escalates on rule 2, proving rule 2 checks indicators independently of classification rather than being redundant with rule 1.

## Persistence (`lib/db/repositories/escalations.ts`, `lib/ai/run-consensus.ts`)

`escalateFromConsensus()` is the primary entry point: compute consensus over the three `AssessorOutcome`s, and — only if the algorithm says to — persist. There is no downgrade step and no suppression path; the function either returns `escalationId: null` because rule 7 said not to escalate, or it creates a real row.

**Idempotency.** Doc 13 §4/deliverable 5 requires escalation creation to be idempotent per `{task_id, attempt}`. Added `outreach_task_id` and `attempt_number` columns to `escalations` plus a unique index on the pair (another schema gap — doc 01's original table predates this doc 13 requirement, same pattern as `ai_usage` and the new `escalation_assessments` table below). `createEscalation()` inserts with `ON CONFLICT DO NOTHING` against that index; on conflict it fetches and returns the existing row instead of erroring or duplicating, and `recordEscalationAssessments()` only runs when the insert genuinely created a new row — a retried call never re-snapshots the assessments either.

**`escalation_assessments`** (new table, doc 13 §3): one row per assessor per escalation, snapshotted at consensus time so it doesn't drift if `triage_results` changes later. A failed assessor gets its own row (`status: "failed"`, `classification: null`, `errorDetail` populated) rather than being silently dropped — this is what makes "Claude said routine, GPT said concerning, the rule engine matched red flag HF-04 — escalated on rule 2" answerable straight from the escalation record, per the doc's acceptance criteria, without re-deriving anything.

**Operational gap found and fixed:** `escalation_assessments` didn't exist in `lib/db/rls.sql`'s tenant-tables list (it's a table doc 13 created; `rls.sql` was last run at doc 02 time) and the one-time `GRANT ... ON ALL TABLES` predates it too — the first real write attempt failed with `permission denied for table escalation_assessments`, not a code bug. Fixed by adding the table to `rls.sql`'s tenant_tables array and re-running `npm run db:rls`; added a maintenance note in the file itself since this is a general trap (any new table needs the same two steps, and nothing enforces it automatically).

## Hard safety rules (doc 13 §4)

- No tool, endpoint, or code path can suppress or downgrade an escalation — there is no such tool in the registry (doc 09), and `escalateFromConsensus` has no parameter that could turn an `escalate: true` verdict into `false`.
- `create_escalation` is allowlisted to `escalation_consensus` only (doc 09's gateway, verified in `tests/ai-tool-gateway.test.ts`).
- The optional arbiter prompt (`lib/ai/prompts/escalation-consensus/v1.ts`, written in doc 09) is explicit that it can only add a rationale on `MATERIAL_DISAGREEMENT`, never downgrade — not yet wired to an actual arbiter call, since that's the doc's own "optional (enhancement)" item.

## What doc 13 does not cover

- The Claude/GPT assessors actually being invoked (prompting, the validation/repair pipeline, transcript-reference hallucination check) — doc 12.
- Real protocol red-flag content — doc 11.
- The reviewer UI showing the three assessments side by side with the firing rule highlighted, and the guarded escalation lifecycle (`OPEN → ASSIGNED → ... → CLOSED`) — doc 17.
