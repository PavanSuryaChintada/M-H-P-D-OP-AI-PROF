# 15 — Mock EHR & Integration Boundary

**PRD:** §6 · **Depends on:** 01, 09

---

## Scope
A replaceable EHR abstraction with a mock implementation that fails realistically.

## Requirements

**R1 — Interface first, implementation second:**
```ts
interface EHRClient {
  getPatient(ctx, patientId): Promise<FHIRPatient>
  getEncounter(ctx, encounterId): Promise<FHIREncounter>
  getConditions(ctx, patientId): Promise<FHIRCondition[]>
  getCarePlan(ctx, patientId): Promise<FHIRCarePlan>
  writeCommunication(ctx, payload, idempotencyKey): Promise<WriteResult>
  writeObservation(ctx, payload, idempotencyKey): Promise<WriteResult>
  createTask(ctx, payload, idempotencyKey): Promise<WriteResult>
  writeEncounterNote(ctx, payload, idempotencyKey): Promise<WriteResult>
}
```
`MockEHRClient` implements it. A real client could replace it without touching callers. **State this replaceability explicitly — PRD §6 asks for it.**

**R2 — The mock runs as a separate route namespace** (`/api/mock-ehr/*`) rather than an in-process function, so it is observably an external system with real latency and real failure. This is a small effort for a large credibility gain.

**R3 — Realistic failure injection**, configurable per hospital (`ehr_settings.failure_rate`):
- Random latency 100–800ms
- Configurable error rate (default 10%) producing 500s
- Occasional 429 rate limit
- Occasional timeout

This exists so your reliability layer (doc 20) has something real to handle, and so the demo can show a failure being retried and recovered.

**R4 — Idempotency:** every write takes a key; replaying returns the original result with `replayed: true`.

**R5 — Observability:** every EHR call logs operation, latency, status, retry count, and appears in the hospital admin's EHR health panel.

**R6 — Explicit failure state.** A failed write sets `ehr_sync_status = failed` with the error, appears in a retry queue, and is retried with backoff by a background job. It is **never** silently dropped.

## Key deliverables
- [ ] `lib/ehr/client.ts` interface + `MockEHRClient`
- [ ] `/api/mock-ehr/*` routes with FHIR-shaped payloads
- [ ] Failure injection controlled by hospital config
- [ ] Idempotency store + replay semantics
- [ ] EHR sync retry worker
- [ ] EHR health panel (calls, success rate, p95 latency, failed writes)
- [ ] Tests: EHR down → documentation still completes with `failed` status and retries successfully afterwards

## Claude Code prompt
```
Implement the mock EHR and integration boundary per docs 01 and 09.

1. lib/ehr/client.ts EHRClient interface with the exact methods in this spec. All writes
   take an idempotency key. Implement MockEHRClient calling /api/mock-ehr/* over HTTP so it
   behaves like a genuine external dependency.
2. /api/mock-ehr routes returning and accepting FHIR-shaped resources: Patient, Encounter,
   Condition, CarePlan, Communication, Observation, Task.
3. Failure injection driven by hospital_config.ehr_settings: random latency 100-800ms,
   configurable error rate defaulting to 10%, occasional 429 and timeout.
4. Idempotency store keyed on the supplied key; replays return the original response with
   replayed:true.
5. Background retry worker for ehr_sync_status='failed' with exponential backoff and a
   maximum attempt count, after which it becomes a visible manual task.
6. Log every EHR call with operation, latency, status and retry count. Build an EHR health
   panel showing call volume, success rate, p95 latency and the failed-write list with a
   retry action.
7. Test: with the error rate forced to 100%, a call still completes and documents with
   ehr_sync_status='failed'; dropping the rate to 0 and running the retry worker syncs it.
```
