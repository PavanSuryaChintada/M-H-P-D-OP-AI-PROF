# 14 — Documentation Agent & Call Records

**PRD:** §19 · **Depends on:** 12, 13, 15

---

## Scope
Turning each attempt into a structured, traceable record and pushing it to the mock EHR.

## Requirements

**R1 — Every attempt produces a record**, including failures. A `NO_ANSWER` produces a documentation record too — that is operational truth a hospital needs.

**R2 — Schema:**
```ts
DocumentationRecord = {
  schema_version: "1.0",
  call_id, patient_id, campaign_id, hospital_id,
  outcome,                              // doc 07 outcome
  summary: string,                      // <= 600 chars, factual, no new clinical claims
  patient_reported_symptoms: [{ symptom, severity_reported, transcript_ref }],
  observations_recorded: string[],      // observation ids created via the tool
  questions_answered: number,
  questions_total: number,
  triage_result_id?, escalation_id?,
  follow_up_actions: [{ action, owner_role, due_by }],
  ehr_sync_status: "pending" | "synced" | "failed",
  generated_by: { model, prompt_version }
}
```

**R3 — No new clinical content.** The documentation agent summarises only what is in the transcript and triage. Run the same transcript-reference verification as doc 12 on any quoted symptom. A documentation agent that invents detail is a clinical-record integrity failure.

**R4 — Traceable.** Every sentence in the summary should be defensible from the transcript. UI shows summary alongside transcript.

**R5 — Cheap model, structured output.** Use Haiku or equivalent. This runs on every call; cost matters and the task is extraction, not reasoning.

**R6 — EHR write** via `update_mock_ehr` tool (doc 15), idempotent, with explicit failure state. A failed EHR sync must be visible and retryable, never swallowed.

## Key deliverables
- [ ] Documentation agent + versioned prompt
- [ ] `documentation_records` table + zod schema
- [ ] Records generated for **all** outcomes, not only completed calls
- [ ] Follow-up action extraction
- [ ] EHR sync with status tracking and retry
- [ ] Call detail UI: transcript | triage | documentation, three panes
- [ ] Tests: no-answer produces a record; fabricated symptom rejected; EHR failure surfaces as `failed` and is retryable

## Claude Code prompt
```
Implement the documentation agent and call records per docs 12, 13, 15.

1. DocumentationRecord zod schema exactly as in this spec.
2. Documentation agent using a cheap structured-output model. It runs after EVERY attempt,
   including NO_ANSWER, BUSY, VOICEMAIL, DROPPED and INVALID_NUMBER, with an
   outcome-appropriate summary.
3. Apply the same transcript-reference verification as triage: any quoted patient symptom
   must actually appear in the transcript, else reject and retry once.
4. The summary must contain no clinical claim absent from the transcript or triage result.
   State this in the prompt and test it with a case designed to tempt embellishment.
5. Extract follow_up_actions with action, owner_role and due_by.
6. Write to the mock EHR via the update_mock_ehr tool with an idempotency key. Track
   ehr_sync_status pending/synced/failed. Failed syncs appear in a retry list.
7. Call detail page with three panes: transcript, triage evidence, documentation.
8. Tests as listed in this spec.
```
