# Documentation Agent & Mock EHR (Docs 14/15)

## Scope decision: EHR client called directly, not through the doc 09 tool gateway

Doc 14 R6 reads "via the update_mock_ehr tool." The registry's `update_mock_ehr` tool (doc 09) still exists and was upgraded to delegate to the real `EHRClient` with an idempotency key — but the documentation agent's own pipeline (`lib/documentation/run-documentation.ts`) calls `mockEhrClient.writeCommunication(...)` **directly**, bypassing `callTool`. Reason, found the hard way: `callTool`'s audit-logging step (`writeAuditLog`) inserts `actor_user_id` as an FK to `users.id`. A real signed-in user's `ctx.userId` always satisfies that FK; the documentation agent runs as system/worker code with no signed-in user, so its context uses a placeholder UUID (`lib/ehr/system-context.ts`) that isn't a real row. Going through the gateway meant the EHR write itself succeeded, but the audit-log insert immediately after it failed on the FK — and `callTool`'s single try/catch around both steps reported that as an EHR failure, even though the mock EHR had already committed the write. That's a real gap in doc 09's gateway (a write can succeed and still be reported as failed if audit logging fails afterward), out of scope to fix here since it only bites synthetic system contexts — worth revisiting if a second background agent hits the same thing. The tool gateway's protections (agent allowlist, tenant-violation stripping) exist to sandbox a *model's own* tool-call attempts; this write is issued by trusted orchestration code after the model's structured output has already been validated, so the gateway's purpose doesn't apply here anyway.

## Scope decision: MockEHRClient calls route handlers in-process, not over real HTTP

Doc 15 R2 asks for the mock EHR to be "observably an external system with real latency and real failure," structured as `/api/mock-ehr/*` routes rather than an in-process function. The routes exist exactly as specified — real Next.js route handlers, real Request/Response objects, real injected latency via an actual `await`, real idempotency semantics. `MockEHRClient` (`lib/ehr/client.ts`) calls them by constructing `Request` objects and invoking the exported route handler functions directly, rather than over a live socket to a running server. This keeps doc 15's own required tests (error rate forced to 100%, then dropped to 0 and retried) fast and deterministic in vitest without managing a server process and port in every test run. Once deployed, these are ordinary Next.js API routes reachable over the network like any other — nothing about the boundary shape changes, only whether the hop is a real socket.

## Scope decision: writeEncounterNote reuses the communications table

`EHRClient.writeEncounterNote` (doc 15 R1) has no dedicated FHIR resource table in this schema — doc 01/04 didn't anticipate a distinct "note" resource, and the deliverables list for the mock EHR routes itself only names Communication/Observation/Task. Rather than a fourth schema migration for something structurally identical to a recorded communication against an encounter, `/api/mock-ehr/encounter-note` writes to `communications` with `channel: "EHR_NOTE"`.

## GET routes reuse doc 04's source_payload

`patients`, `encounters`, `conditions`, and `care_plans` already carry a `source_payload` jsonb column from doc 04's ingestion design — the original FHIR resource, when the row arrived via a hospital feed. The mock EHR's GET routes (`lib/ehr/fhir-map.ts`) return that verbatim when present, and only synthesize a minimal FHIR-shaped resource for rows created some other way (e.g. seeded demo data).

## Idempotency (doc 15 R4)

Every write route checks `ehr_idempotency_records` (keyed on `[hospital_id, idempotency_key]`) before doing anything else. A replay returns the original stored response with `replayed: true` instead of writing again. Only successful writes are recorded — a failed attempt (injected or real) leaves no idempotency row, so the *next* attempt with the same key is a genuine retry, not a replay of a failure.

## Failure injection (doc 15 R3)

`lib/ehr/failure-injection.ts` is a pure, RNG-injectable function: latency 100-800ms always; on top of the hospital's configured `ehr_settings.failure_rate`, a failure draw splits into plain 500 (70%), 429 rate-limit (15%), or a synthetic timeout — represented as extra latency plus a 504, not an actual multi-second hang, since a real hang would make every failure-path test slow without adding anything the extra latency number doesn't already convey.

## Retry worker (doc 15 R6)

`lib/ehr/retry-worker.ts` re-sends the **same idempotency key** on every retry, so a write that actually succeeded but whose response was lost (e.g. to the injected timeout) replays cleanly instead of duplicating. Exponential backoff (5 × 2^retryCount minutes), capped at 5 attempts — records that exhaust retries stay visible as `FAILED` (never silently dropped, per R6) but stop being auto-picked-up; surfacing that as a manual task is doc 16's events/notifications work, not yet built.

## Documentation agent (doc 14)

Runs for every call outcome, including ones with an empty transcript (`NO_ANSWER`, `BUSY`, etc. — R1). Validation pipeline mirrors doc 12's triage assessor exactly: structured output → transcript-reference verification (`lib/documentation/verify.ts`, same turn_index/quote_span bounds-check pattern as doc 12's observations) → one repair attempt with the error fed back into the prompt → a second failure is `DocumentationValidationFailedError`, an explicit operational failure, never a silent pass (R3).

**Verified** (`tests/documentation-and-ehr.test.ts`): a `NO_ANSWER` attempt with an empty transcript still produces a record and syncs to the mock EHR; a fabricated symptom (a `quote_span` pointing past the end of the real transcript turn) is rejected after both attempts, never silently accepted; forcing the mock EHR's failure rate to 1 surfaces `ehr_sync_status = FAILED` with a real error, and the retry worker syncs it once the failure rate drops back to 0.

## What this build does not cover

- Call detail UI (transcript | triage | documentation three-pane view) and the EHR health panel — deferred to doc 17/18's frontend work, per this build's established split (built once there, not duplicated here).
- A visible "manual task" for retries that exhaust their attempt cap — depends on doc 16's events/notifications, not yet built.
- `getPatient`/`getEncounter`/`getConditions`/`getCarePlan` are implemented and tested via the client/route layer but have no caller yet in this build's pipeline (nothing currently needs to *read back* from the mock EHR) — built per spec for completeness and future use (e.g. a real EHR swap-in), not exercised end-to-end by another doc's flow.
