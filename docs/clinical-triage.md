# Clinical Triage & Structured AI Outputs (Doc 12)

## Schema

`lib/ai/schemas/triage.ts` — built ahead of schedule as a doc 13 prerequisite (see `docs/escalation-consensus.md`). Exactly doc 12 R1's shape, zod-validated: `schema_version`, `assessor_id`, `classification`, `confidence`, `observations[]` (each with a `transcript_ref`), `indicators[]` (each with `evidence` and `protocol_reference`), `missing_information[]`, `escalation_recommended`, `reasoning_summary`.

## The two LLM assessors

`clinical-triage-v1` (Claude, protocol-first) and `second-assessor-v1` (GPT, symptom-first) — prompts written in doc 09, invoked here via `lib/ai/triage/run-assessor.ts`'s `runTriageAssessor()`. Structured output goes through `lib/ai/providers/managed-call.ts`'s `runStructured()` with forced tool-use (doc 09), so there's no raw-JSON-with-fence-stripping step in this implementation — a forced tool-use response is already a parsed object, not text to extract JSON from. The requirement doc 12 R3 is actually protecting against (a model producing something that isn't valid structured output) is still fully handled; it just enters this pipeline as a schema-validation failure rather than a JSON-parse failure.

## Validation pipeline (R3)

```
generateStructured (schema-validated inside the provider call)
  → fail (isValidationFailure)              → repair attempt (error fed back into a fresh prompt)
  → transcript-ref / grounding check          → fail → repair attempt (error fed back)
  → second failure of either kind            → TriageValidationFailedError ("TRIAGE_VALIDATION_FAILED")
  → accept, apply uncertainty forcing, persist
```

One repair attempt total, whichever check failed. A second failure is thrown, not swallowed — `settleAssessors()` (doc 13, via `Promise.allSettled`) turns that thrown error into an `ASSESSOR_FAILURE` outcome, which the *existing* consensus algorithm already escalates on (rule 4). No new escalation path was needed for this — doc 13's infrastructure was already built to handle exactly this failure shape.

**A real gap this surfaced, fixed rather than worked around:** `managed-call.ts`'s `runStructured()` originally collapsed every failure (network timeout, exhausted retries, schema validation) into the same generic `PROVIDER_ERROR` result, with no way for a caller to tell a validation failure (repairable — feed the error back and try again) from a genuine provider outage (not repairable — there's nothing to correct). Added `isValidationFailure?: boolean` to `ManagedResult`'s failure branch so `runTriageAssessor()` can route correctly: a validation failure re-enters the repair loop, anything else throws immediately.

## Hallucination guard (R4) — `lib/ai/triage/verify.ts`

The strongest, cheapest anti-hallucination control available, per the spec. Two different checks for the two ref styles the schema uses:

- **Indicators** carry a literal `evidence.excerpt` string — checked with a direct case-insensitive substring search against the transcript turn it claims to be in. This is the actual fabricated-quote catch: if the model asserts a quote that was never said, the substring search fails and the indicator is rejected.
- **Observations** carry `transcript_ref.quote_span` (position indices, not a literal string) — checked for being in-bounds within that turn's real text length. There's no separate claimed-text string to compare for observations, so an out-of-bounds span is the fabrication signature there instead.
- **Grounding** (non-empty indicators require a real `protocol_reference`) is already structurally enforced by the schema (the field is required, not optional) — kept as an explicit, separate assertion in the verifier anyway so the check is legible on its own rather than implicit in a zod shape.

## Confidence forcing (R5 + the Claude Code prompt's two extra conditions) — `lib/ai/triage/uncertainty.ts`

Three independent conditions force `routine` down to `uncertain`, each checked separately so a reviewer can see exactly which one fired:

1. `confidence < 0.6` on a `routine` classification (R5's own stated threshold).
2. `missing_information.length / totalProtocolQuestions > 0.3`.
3. The call this triage is based on ended in `DROPPED`.

## Persistence (R7)

`lib/db/repositories/triage-results.ts`. **Schema gap found and fixed** (same pattern as `ai_usage` in doc 09 and `escalations`/`escalation_assessments` in doc 13): doc 01's `triage_results` table had `classification`/`observedIndicators`/`evidence`/`protocolReferences`/`confidence`/`escalationRecommended`/`modelProvider` but was missing everything doc 12 R7 explicitly asks for — raw model output, parsed result, prompt version, model name, retrieval chunk ids, validation attempt count, latency, cost. Added all eight via an additive migration. (`modelProvider` already existed and stores the vendor id — "anthropic"/"openai"/"rule-engine" — so the new `modelName` column is deliberately separate, for the actual model string like `claude-sonnet-5`.)

## End-to-end entry point

`lib/ai/triage/run-pipeline.ts`'s `runTriagePipeline()` is what a completed call hands off to: builds the triage context (doc 09), runs Claude, GPT, and the rule engine (doc 13) in parallel via `settleAssessors()`, and hands the three outcomes to `escalateFromConsensus()` (doc 13). This is the single function doc 10 (voice intake / call handling) calls once a call ends — everything from context assembly through persistence through the escalation decision happens inside it.

**Verified** (`tests/triage-verify.test.ts`, `tests/triage-uncertainty.test.ts`, `tests/triage-run-assessor.test.ts` — 18 tests total): a fabricated quote is rejected and, separately, repaired when corrected on the second attempt; a malformed (schema-invalid) first response is repaired on the second attempt; two malformed responses in a row throw `TriageValidationFailedError`; each of the three uncertainty-forcing conditions fires independently and a confident/complete/non-dropped result is left unchanged; and — the full doc 12 → doc 13 handoff, end to end against the live DB — an assessor that fails validation twice becomes an `ASSESSOR_FAILURE` that the consensus algorithm correctly escalates on rule 4.

## What doc 12 does not cover

- Real protocol chunk retrieval feeding `retrievedChunks` — doc 11 (the context builder and prompt already accept retrieved chunks as an input; only *where they come from* is still a stub).
- The reviewer UI showing each indicator beside its protocol excerpt and transcript quote — doc 17.
- The Voice Intake Agent's own conversation loop and the call record `transcript`/`structuredObservations` actually being produced — doc 10.
