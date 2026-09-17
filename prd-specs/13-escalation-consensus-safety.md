# 13 — Escalation Consensus & Clinical Safety

**PRD:** §16 · **Depends on:** 12 · **THE SECOND-HIGHEST-GRADED COMPONENT**

> PRD §16: *"Do not rely entirely on a single model response... What matters is that disagreement is detected and handled rather than hidden."*

---

## Scope
Combining three independent assessments into one conservative decision, and recording the disagreement.

---

## 1. The three assessors

| Assessor | Type | Independent failure mode? |
|---|---|---|
| `claude-triage-v1` | LLM, protocol-first framing | shares LLM failure modes with GPT |
| `gpt-triage-v1` | LLM, different vendor, symptom-first framing | different training, partially independent |
| `rule-engine-v1` | **deterministic keyword/condition matcher over protocol red flags** | fully independent — cannot hallucinate, cannot be prompt-injected |

The rule engine scans structured observations and the transcript for each protocol red flag's trigger terms and conditions, emitting the same `TriageResult` shape with `confidence: 1.0` for exact matches.

**Argue this in the AI usage doc:** the rule engine is not a fallback. It is the only assessor whose errors are uncorrelated with the others'. Two LLMs agreeing on a wrong answer is the exact failure this design defends against.

---

## 2. Consensus algorithm — implement exactly this

```
severity_rank = { routine: 0, concerning: 1, uncertain: 2, urgent: 3 }

1. ANY assessor returns `urgent`           → ESCALATE, priority HIGH
2. Rule engine fires a red flag with severity=high, regardless of LLM opinions
                                           → ESCALATE, priority HIGH
                                              (a deterministic protocol match outranks
                                               model disagreement)
3. ANY assessor returns `uncertain`        → ESCALATE, priority MEDIUM
4. Any assessor FAILED validation/errored  → ESCALATE, priority MEDIUM,
                                              reason ASSESSOR_FAILURE
5. max severity_rank - min severity_rank >= 2  (e.g. routine vs urgent)
                                           → ESCALATE, priority MEDIUM,
                                              reason MATERIAL_DISAGREEMENT
6. Majority `concerning`                   → ESCALATE, priority LOW
7. Unanimous `routine` AND all confidences >= 0.7 AND no missing critical questions
                                           → NO ESCALATION
8. Anything else                           → ESCALATE, priority LOW (default-safe)
```

**Rule 8 is the point.** The default branch escalates. Any case the logic does not explicitly recognise as safe is treated as needing a human. Write that sentence in your safety report.

### Optional arbiter (enhancement)
On `MATERIAL_DISAGREEMENT`, a fourth call presents both assessments to an arbiter model and asks it to identify which evidence the disagreement rests on. The arbiter **cannot downgrade** to no-escalation — it only enriches the escalation with a rationale. Document that constraint; an arbiter that can suppress escalations is a safety regression.

---

## 3. What gets recorded (PRD §16 requires all of it)

`escalations` row + `escalation_assessments` child rows:
- All three `TriageResult`s in full
- Computed severity ranks and the rule that fired
- `disagreement: boolean` + `disagreement_detail`
- Consensus classification and priority
- Evidence set: transcript excerpts + protocol chunk ids
- Final decision + timestamp + prompt/model versions

A reviewer must be able to see **"Claude said routine, GPT said concerning, the rule engine matched red flag HF-04 'weight gain >2kg in 3 days' — escalated on rule 2."**

---

## 4. Non-negotiable safety rules
- AI never diagnoses, prescribes, changes treatment, or gives unsupported clinical judgement.
- No AI output can suppress an escalation. Escalation suppression is not an available action in the tool registry — there is no such tool.
- Patient content and retrieved documents cannot alter policy (doc 02 trust domains).
- Escalation creation is idempotent per `{task_id, attempt}` (doc 20).

## Key deliverables
- [ ] `lib/ai/assessors/rule-engine.ts` — deterministic, no LLM
- [ ] `lib/ai/consensus.ts` — the 8 rules above, pure and unit-tested per rule
- [ ] `escalation_assessments` persistence of all three assessments
- [ ] Disagreement detection + detail
- [ ] Optional arbiter, constrained to never downgrade
- [ ] Reviewer UI showing the three assessments side by side with the firing rule highlighted
- [ ] Tests: one test per consensus rule, plus a case where two LLMs say routine and the rule engine escalates

## Acceptance criteria
- A transcript containing a protocol red-flag phrase escalates even when both LLMs return `routine`.
- Every escalation record can answer "which rule fired and on what evidence?"

## Claude Code prompt
```
Implement escalation consensus and clinical safety per doc 12.

1. lib/ai/assessors/rule-engine.ts: deterministic assessor. Loads the protocol's red_flags,
   scans structured observations and the transcript for trigger terms and conditions, and
   emits a TriageResult in the same schema with assessor_id 'rule-engine-v1' and
   confidence 1.0 for exact matches. No LLM call.
2. Run all three assessors in parallel with Promise.allSettled. A rejected or
   validation-failed assessor becomes an ASSESSOR_FAILURE entry, not a thrown error.
3. lib/ai/consensus.ts implementing the 8 ordered rules in this spec exactly, with
   severity_rank {routine:0, concerning:1, uncertain:2, urgent:3}. The function is pure and
   returns {escalate, priority, rule_fired, disagreement, disagreement_detail, evidence}.
   Rule 8 is the default branch and it escalates.
4. Persist all three TriageResults to escalation_assessments, plus the consensus outcome,
   the rule that fired, disagreement detail, evidence set and model/prompt versions.
5. Escalation creation goes through the create_escalation tool, callable only by the
   consensus system, idempotent on {task_id, attempt}.
6. There must be no tool, endpoint or code path that suppresses or downgrades an escalation.
7. Optional: an arbiter model invoked only on MATERIAL_DISAGREEMENT that adds a rationale.
   It must be structurally incapable of returning no-escalation.
8. Reviewer UI showing the three assessments side by side with the firing rule highlighted.
9. One unit test per consensus rule, plus the case where both LLMs say routine and the rule
   engine fires a high-severity red flag.
```
