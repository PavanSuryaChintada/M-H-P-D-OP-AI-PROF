# Clinical Protocols & Tenant-Aware Retrieval (Doc 11)

## Structured protocol shape (R1)

`lib/protocols/schema.ts` — zod-validated on write (`createProtocol`), stored in `protocols.structured_content` alongside `protocols.content` (the source document that chunking/retrieval reads). Every protocol has `followUpQuestions[]` (8-12, each with `id`/`text`/`answerType`/`probeQuestions`), `redFlags[]` (6-10, each with `id`/`description`/`triggerKeywords`/`severity`/`requiredAction`), `approvedGuidance[]`, `escalationRules[]`, `specialty`, `version`, `effectiveFrom`. **Schema gap found and fixed** (same pattern as every other doc in this AI block): doc 01's `protocols` table only stored `title`/`category`/`content`/`version` — no structured form at all. Added `structured_content` (jsonb), `specialty`, `effective_from` via an additive migration; `knowledge_chunks` also gained `section`, `heading`, `protocol_version` (snapshotted at chunk-creation time, not re-joined from `protocols.version` which can change later — a citation should always point at the exact text version it was generated from).

## Three seeded protocols (R2)

`lib/protocols/seeds/{hip-replacement,heart-failure,general-medical}.ts` — post-surgical (total hip replacement, 10 questions/7 red flags), cardiac (heart failure discharge, 10 questions/8 red flags), general medical (9 questions/7 red flags). Demo-shaped clinical content: realistic in structure, terminology, and red-flag reasoning for the purposes of this build, not a substitute for real hospital-authored protocols. Seeded into the four named demo hospitals via `npm run seed:protocols` (added to the `seed:demo` chain, right where doc 03's own hospital-seeding script had explicitly flagged "at least one protocol" as the one remaining readiness gap "until doc 11 lands" — that gap is now closed).

## Chunking (R3)

`lib/protocols/chunker.ts` chunks **by structural unit** — one chunk per red flag, one per batch of ~4 follow-up questions, one per guidance item, one for the escalation-rule table — rather than naively splitting arbitrary prose into fixed-size windows. This keeps a red flag's trigger terms and required action from ever being split across two chunks, and `{protocol_id, section, heading}` falls out of the structure directly instead of being inferred from free text. `renderProtocolDocument()` renders the structured form into the prose stored in `protocols.content` (R1's "store both the structured form and the source document"), so the two stay consistent by construction rather than being authored separately.

## Embeddings

`lib/ai/embeddings/` — same abstraction pattern as doc 09's `AIProvider`: an `EmbeddingProvider` interface, `OpenAIEmbeddingProvider` (text-embedding-3-small, 1536 dimensions, matching `knowledge_chunks.embedding`) for real semantic search, and `MockEmbeddingProvider` (deterministic feature-hashed bag-of-words, no API key needed) for tests and seeding. The mock is explicitly **not** a real semantic embedding — texts sharing more words land closer under cosine similarity than unrelated texts, which is enough to prove the retrieval *plumbing* (tenant scoping, merge/rerank, citation shape) without claiming real semantic quality. `npm run seed:protocols` uses the mock unless `OPENAI_API_KEY` is set, in which case real embeddings are used automatically.

## Hybrid retrieval (R4, R5)

`lib/ai/retrieval.ts`'s `hybridSearch()`: vector similarity (`lib/db/repositories/knowledge-chunks.ts`'s `vectorSearch`, via drizzle's `cosineDistance`) merged with keyword match on caller-supplied trigger terms (`keywordSearch`, `ILIKE`). **Keyword hits are ranked first, not averaged into one score** — doc 11's own rationale is that this is the safety-critical path ("pure vector search misses exact red-flag phrases like 'calf swelling', which is exactly what you cannot afford to miss"), so an exact trigger-term match outranks a merely-similar vector match by design, not by tuning.

`hospital_id` is `ctx.hospitalId` in every query, never a function argument — enforced at the SQL level (the where-clause parameter comes from `TenantContext`, not from any caller-supplied value) plus RLS as the second layer, exactly per R4's stated architecture.

**Verified** (`tests/retrieval-cross-tenant.test.ts`, 5 tests): a query built specifically to strongly match Hospital B's content — a distinctive marker phrase injected into every B chunk, used as both the vector-search query text and the keyword-search term — run under Hospital A's context returns zero B chunks, checked at three levels: `hybridSearch()`, the two repository functions individually (`vectorSearch`/`keywordSearch`), and a raw, deliberately unfiltered `SELECT * FROM knowledge_chunks` under RLS with no `WHERE` clause at all (same two-layer pattern as `tests/tenancy.test.ts`). A companion assertion (`keywordSearch(ctxB, ...)` does find its own marker) proves the test isn't vacuously passing because the query matches nothing anywhere.

## Citations (R6) and grounding (R8)

Every retrieved chunk returns `{chunk_id, protocol_id, protocol_version, section, text}` (`Citation` in `lib/ai/retrieval.ts`) — a reviewer clicking a triage conclusion can resolve straight back to the source text. `assertGrounded()` rejects a `TriageResult` with non-empty `indicators` but any indicator missing a real `protocol_reference` — this is intentionally the same property doc 12's schema already makes structurally hard to violate (the field is required) and doc 12's own hallucination guard (`verifyTranscriptRefs`) already checks; `assertGrounded` is doc 11's own explicit, separately-callable assertion of the identical rule, per its own deliverable checklist, not a competing implementation.

## Task-specific retrieval (R7)

`getIntakeQuestions()` and `getTriageContext(symptoms[])` — intake retrieves the question set, triage retrieves red-flag/severity sections filtered by symptoms actually mentioned. Neither loads the whole protocol into a call; `getTriageContext` returns nothing at all (not the whole protocol) when no symptoms were mentioned yet, and uses the mentioned symptoms themselves as the keyword-search terms, since a symptom the patient actually said is exactly the kind of exact-phrase signal R5 prioritizes.

## Rule engine integration

`lib/db/repositories/protocols.ts`'s `getRedFlagsForProtocol()` reshapes a protocol's structured `redFlags[]` into the `RedFlag[]` shape doc 13's `runRuleEngine()` (deliberately pure and DB-free, built before this doc existed) already expects — the exact "doc 11 supplies real data, zero changes to the rule engine itself" handoff that was planned when the rule engine was written.

## What doc 11 does not cover (deferred to frontend docs, per this build's stated split)

- Protocol upload/edit UI.
- Citation display in the reviewer UI (click an indicator → see the source chunk text) — doc 17's reviewer screen is where this actually lives; building it here would mean building it twice.
