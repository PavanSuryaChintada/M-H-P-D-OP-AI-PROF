# 04 — Patient & Discharge Data Ingestion

**PRD:** §5 · **Depends on:** 01, 03

---

## Scope
Getting 400–500 realistic patients across hospitals into FHIR-shaped tables, with enough variation that the queue demo is interesting.

## Requirements

**R1 — Volume & spread:** 400–500 patients across the 3 hospitals. Weighted so the low-capacity hospital still has ~80 patients — that is what makes concurrency visible.

**R2 — Variation the queue needs.** The generator must deliberately produce:
- Risk indicators: low / medium / high / critical (roughly 50/30/15/5)
- Discharge timestamps spread across the last 72h, including some with **<2h left** in their follow-up window
- Follow-up windows of 24h, 48h, 72h, 7d
- Contact preferences: preferred time-of-day windows, "no calls before 10am", language
- ~8% invalid/unreachable numbers
- ~12% who will request callbacks
- ~15% who will present protocol red flags in conversation
- A handful of patients eligible for **two campaigns at once** (tests fairness)

**R3 — FHIR-shaped writes:** each patient produces `Patient`, `Encounter`, `Condition`(s), `Observation`(s), `MedicationStatement`(s), `CarePlan`, plus discharge instructions text.

**R4 — Ingestion is a pipeline, not a script:** `POST /api/hospitals/:id/discharges` accepts a batch, validates per-record, and returns `{accepted, rejected[]}` with per-record reasons. Partial success is allowed; silent drops are not.

**R5 — Idempotent:** re-posting the same `source_message_id` does not duplicate. (See doc 20.)

**R6 — Emits events:** `patient.imported`, `discharge.ingested` (doc 16).

## Key deliverables
- [ ] `sim/generate-patients.ts` — seeded, deterministic generator (fixed RNG seed so the demo is reproducible)
- [ ] Batch ingestion endpoint with per-record validation errors
- [ ] `seed:demo` npm script producing the full demo dataset in one command
- [ ] A CSV/NDJSON sample file committed to the repo as the "hospital feed"
- [ ] Patient detail page showing the FHIR-shaped resources (doc 18 links to it)
- [ ] Test: ingesting the same batch twice yields the same row count

## Acceptance criteria
- `npm run seed:demo` from empty DB produces 3 hospitals, users, protocols, ~450 patients, deterministically.
- A batch with 3 malformed rows out of 50 accepts 47 and reports 3 with field-level reasons.

## Claude Code prompt
```
Implement discharge ingestion and the demo data generator per docs 01 and 03.

1. sim/generate-patients.ts — deterministic (seeded RNG) generator producing 400-500 patients
   across the 3 seeded hospitals with the exact variation profile in this spec: risk mix,
   discharge times spread over 72h including some with under 2 hours of window remaining,
   mixed follow-up windows, contact preferences, ~8% invalid numbers, ~12% callback
   requesters, ~15% red-flag presenters, and some patients eligible for two campaigns.
2. Each generated patient writes FHIR-shaped rows: Patient, Encounter, Condition,
   Observation, MedicationStatement, CarePlan, plus discharge instruction text.
3. POST /api/hospitals/:id/discharges accepting NDJSON or JSON array, validating each record
   with zod, returning {accepted, rejected:[{index, field, reason}]}. Partial success allowed.
4. Idempotency on source_message_id: re-posting the same batch must not duplicate rows.
5. Emit patient.imported and discharge.ingested events.
6. npm script seed:demo that runs the whole thing from an empty database.
7. Commit a sample feed file to /sim/fixtures.
```
