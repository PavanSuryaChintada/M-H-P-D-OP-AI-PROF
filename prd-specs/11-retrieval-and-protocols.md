# 11 — Clinical Protocols & Tenant-Aware Retrieval

**PRD:** §7 · **Depends on:** 01, 03 · **Feeds:** 10, 12, 13

---

## Scope
Hospital-specific protocol content, how it is chunked and retrieved, and how grounding is enforced.

## Requirements

**R1 — Protocol structure** (not just a blob of text). Each protocol has:
- `follow_up_questions[]` — ordered, each with id, text, expected answer type, probe questions
- `red_flags[]` — each with id, description, trigger keywords/conditions, severity, required action
- `approved_guidance[]` — the only patient-facing advice the agent may give
- `escalation_rules[]` — condition → escalation priority
- `specialty`, `version`, `effective_from`

Store both the structured form **and** the source document. The structured form drives the rule engine (doc 13); the text drives retrieval.

**R2 — Seed three real-shaped protocols:** post-surgical (e.g. hip replacement), cardiac (heart failure discharge), general medical. Each with 8–12 questions and 6–10 red flags. Write them properly — the whole safety layer's credibility rests on them.

**R3 — Chunking:** semantic chunks of 200–400 tokens with `{protocol_id, section, heading}` metadata preserved. Every chunk carries `hospital_id`.

**R4 — Retrieval is tenant-scoped at the SQL level:**
```sql
SELECT ... FROM knowledge_chunks
 WHERE hospital_id = $1        -- never optional, never from AI input
 ORDER BY embedding <=> $2 LIMIT $3
```
Plus RLS as the second layer. Write a test that attempts retrieval with Hospital B's embedding under Hospital A's context and asserts zero B chunks.

**R5 — Hybrid retrieval:** vector similarity + keyword match on red-flag trigger terms, merged and reranked. Pure vector search misses exact red-flag phrases like "calf swelling", which is exactly what you cannot afford to miss.

**R6 — Citations are mandatory.** Every retrieved chunk returns `{chunk_id, protocol_id, protocol_version, section, text}`. Triage output must reference chunk ids. A reviewer clicking a triage conclusion sees the source text. **PRD §7 requires source preservation.**

**R7 — Task-specific retrieval.** Intake retrieves the question set. Triage retrieves red-flag and severity sections filtered by symptoms actually mentioned. Do not load the whole protocol into every call.

**R8 — Grounding enforcement:** triage prompts state that any clinical claim must cite a retrieved chunk id. Post-validation rejects a `TriageResult` whose `protocol_references` are empty while `indicators` are non-empty.

## Key deliverables
- [ ] Protocol schema (structured + source doc) + upload/edit UI
- [ ] 3 seeded protocols, properly written
- [ ] Chunker + embedding pipeline into pgvector
- [ ] `lib/ai/retrieval.ts` — hybrid search, tenant-scoped, returns citations
- [ ] Cross-tenant retrieval test
- [ ] Citation display in the reviewer UI (click evidence → see source text)
- [ ] Grounding validator rejecting uncited clinical claims

## Acceptance criteria
- A Hospital A patient's triage never surfaces a Hospital B chunk, proven by test.
- Every red-flag indicator in a triage result resolves to a viewable protocol excerpt.

## Claude Code prompt
```
Implement protocols and tenant-aware retrieval per docs 01 and 03.

1. protocols table storing both structured JSON (follow_up_questions[], red_flags[],
   approved_guidance[], escalation_rules[], specialty, version, effective_from) and the
   source document text. Validate the structure with zod on write.
2. Author and seed three protocols: post-surgical hip replacement, heart failure discharge,
   general medical discharge. Each with 8-12 follow-up questions (id, text, answer type,
   probe questions) and 6-10 red flags (id, description, trigger terms, severity, action).
3. Chunker producing 200-400 token semantic chunks preserving protocol_id, section and
   heading. Embed into pgvector. Every chunk row carries hospital_id.
4. lib/ai/retrieval.ts: hybrid search combining cosine similarity and keyword matching on
   red-flag trigger terms, merged and reranked. hospital_id comes from TenantContext and is
   never accepted as an argument from AI. Returns citations
   {chunk_id, protocol_id, protocol_version, section, text}.
5. Task-specific retrieval helpers: getIntakeQuestions(protocolId) and
   getTriageContext(symptoms[]) which filters to relevant red-flag and severity sections.
6. A grounding validator that rejects a TriageResult with non-empty indicators but empty
   protocol_references.
7. Test: run retrieval under Hospital A context using a query that strongly matches a
   Hospital B chunk, assert zero B results, both through the repository and under RLS.
```
