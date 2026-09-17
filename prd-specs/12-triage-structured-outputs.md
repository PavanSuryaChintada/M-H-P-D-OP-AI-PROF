# 12 — Clinical Triage & Structured AI Outputs

**PRD:** §15 · **Depends on:** 09, 11 · **Critical**

---

## Scope
Turning a conversation into a validated, evidence-bearing clinical assessment.

## Requirements

**R1 — The schema.** Fixed, versioned, zod-validated:

```ts
TriageResult = {
  schema_version: "1.0",
  assessor_id: string,              // "claude-triage-v1" | "gpt-triage-v1" | "rule-engine-v1"
  classification: "routine" | "concerning" | "urgent" | "uncertain",
  confidence: number,               // 0-1
  observations: [{
    code: string,                   // e.g. "pain_score", "wound_appearance"
    value: string | number,
    unit?: string,
    reported_by: "patient" | "carer",
    transcript_ref: { turn_index: number, quote_span: [number, number] }
  }],
  indicators: [{
    indicator_id: string,           // maps to a protocol red_flag id
    description: string,
    severity: "low" | "moderate" | "high",
    evidence: { turn_index: number, excerpt: string },
    protocol_reference: { chunk_id: string, protocol_id: string, version: string }
  }],
  missing_information: string[],    // questions not answered - drives uncertainty
  escalation_recommended: boolean,
  escalation_reason?: string,
  reasoning_summary: string         // <= 400 chars, for human reviewers
}
```

**R2 — `uncertain` is a first-class outcome.** If the conversation was cut short, the patient was confused, key questions went unanswered, or evidence conflicts → `uncertain`, not `routine`. PRD §2: *"the safer behavior is to escalate rather than silently classify a potentially concerning patient as routine."*

**R3 — Validation pipeline:**
```
raw model output
  → JSON parse (strip fences)         → fail → repair attempt 1
  → zod validate                       → fail → repair attempt 1
  → grounding check (indicators cite chunks)  → fail → repair attempt 1
  → transcript-ref check (turn indices exist, excerpts actually appear) → fail → reject
  → accept
```
One repair attempt with the validation error fed back. Second failure → `TRIAGE_VALIDATION_FAILED`, which is an **explicit operational failure that escalates**, never a silent pass. PRD §15 requires exactly this.

**R4 — Hallucination guard.** The transcript-ref check is the strongest anti-hallucination control you have and it is cheap: if the model claims the patient said something, the quoted excerpt must actually appear in that turn. Reject if not. **Put this in your AI usage doc — most candidates will not have it.**

**R5 — Confidence is not decorative.** `confidence < 0.6` on a `routine` classification forces `uncertain`. Document the threshold and how you chose it.

**R6 — Observations are written through the tool gateway** (`record_observation`), producing FHIR-shaped `Observation` rows linked to the encounter. AI does not write them directly.

**R7 — Traceability.** `triage_results` stores: raw model output, parsed result, prompt version, model, retrieval chunk ids, validation attempts, latency, cost.

## Key deliverables
- [ ] `lib/ai/schemas/triage.ts` — zod schema, versioned
- [ ] Triage agent (Claude) + second assessor (GPT, different prompt framing)
- [ ] Validation pipeline with one-shot repair
- [ ] Transcript-reference verifier
- [ ] `TRIAGE_VALIDATION_FAILED` → escalation path
- [ ] `record_observation` writing FHIR-shaped rows
- [ ] Reviewer UI: indicator → protocol excerpt + transcript quote, side by side
- [ ] Tests: malformed JSON repaired; twice-malformed escalates; fabricated quote rejected; low-confidence routine forced to uncertain

## Acceptance criteria
- Feed a model output containing a quote that is not in the transcript → rejected, logged, escalated.
- A conversation with 4 of 10 questions unanswered classifies `uncertain`, not `routine`.

## Claude Code prompt
```
Implement clinical triage and structured output validation per docs 09 and 11.

1. lib/ai/schemas/triage.ts: zod schema exactly as specified in this doc, with
   schema_version, assessor_id, classification (routine|concerning|urgent|uncertain),
   confidence, observations[] with transcript_ref, indicators[] with evidence and
   protocol_reference, missing_information[], escalation_recommended, escalation_reason,
   reasoning_summary.
2. Two LLM assessors: claude-triage-v1 and gpt-triage-v1 with deliberately different prompt
   framing (one protocol-first, one symptom-first). Both emit the same schema.
3. Validation pipeline: JSON parse with fence stripping, zod validate, grounding check
   (non-empty indicators require non-empty protocol_references), and a transcript-reference
   verifier asserting every quoted excerpt actually appears in the referenced turn.
   On failure, one repair attempt feeding the validation error back. Second failure produces
   TRIAGE_VALIDATION_FAILED which forces an escalation, never a silent pass.
4. Force classification to 'uncertain' when confidence < 0.6 on routine, when
   missing_information covers more than 30% of protocol questions, or when the call ended
   in DROPPED.
5. Observations are persisted only via the record_observation tool, producing FHIR-shaped
   Observation rows linked to the encounter.
6. Persist to triage_results: raw output, parsed result, prompt_version, model, retrieval
   chunk ids, validation attempt count, latency, estimated cost.
7. Reviewer UI component showing each indicator beside its protocol excerpt and its
   transcript quote.
8. Tests: repaired malformed JSON, twice-malformed escalation, fabricated quote rejection,
   low-confidence forcing uncertain.
```
