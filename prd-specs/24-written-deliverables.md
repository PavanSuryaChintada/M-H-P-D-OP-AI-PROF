# 24 — Written Deliverables & Demo Video

**PRD:** §33 · **Do not leave to the last night**

---

## Scope
The nine submission items. Several of these are where marks are won cheaply, and where tired candidates lose them.

---

## 1. Deployed application
URL + credentials (doc 23). Verify from a private window an hour before submitting.

## 2. Source repository
Public GitHub, README per doc 23, `.env.example`, migrations, seed, sim, eval, tests, deployment notes.

## 3. Demo video (8–12 min, scripted)

Shot list — follow it, do not improvise:

| # | Segment | Time | Must show |
|---|---|---|---|
| 1 | Hospital onboarding | 0:30 | config, capacity, calling hours, readiness checklist |
| 2 | Discharge ingestion | 0:30 | batch upload, partial success with rejection reasons |
| 3 | Campaign + eligibility | 1:00 | criteria, workload estimate, "why not eligible" drill-down |
| 4 | **Queue under constraint** | **2:30** | capacity 3, gauge never exceeding it, tier ordering, score popover, deadline patient jumping the queue |
| 5 | **Failure handling** | **1:30** | kill worker → reaper reclaims; drop call → context-preserving resume; invalid number → manual |
| 6 | AI conversation | 1:00 | transcript, protocol-driven questions, refusal of an advice request |
| 7 | **Triage + consensus** | **1:30** | three assessments side by side, disagreement, rule engine overriding both LLMs |
| 8 | Human review | 1:00 | reviewer queue, evidence, protocol citation, structured resolution |
| 9 | EHR + documentation | 0:30 | documentation record, EHR write, a failed sync retried |
| 10 | Analytics + health | 0:30 | dashboards, health endpoint with the queue block |
| 11 | Safety evaluation | 1:00 | run the eval, show the FN rate, walk one disagreement case |

**Segments 4, 5 and 7 are 5½ of 12 minutes.** That ratio matches the grading weights. Do not spend three minutes on your login screen.

## 4. Architecture documentation
**One** system diagram (PRD §26 explicitly says do not submit repetitive diagrams). Mermaid. Plus: component responsibilities, the five key boundaries (AI↔tools, queue↔calling, EHR abstraction, events, observability), and the stack justification from doc 00.

## 5. Queue design document
Assemble from docs 06–08. Must contain: state machine diagram, **the priority formula with weights and the reasoning for each weight**, the worked example, concurrency mechanism with the actual SQL, retry and backoff policy table, callback handling, deadline behaviour, fairness and starvation prevention, failure recovery, manual escalation, and **why Postgres over Redis**.

> PRD §12: *"The design must justify the chosen approach rather than merely describing implementation details."* Every section ends with a "why" paragraph.

## 6. Safety evaluation report
From doc 21. Dataset description, matrix, FN rate, per-category, 2–3 worked disagreement cases with real transcripts, limitations, improvements.

## 7. AI usage documentation
Models and why each was chosen · agent responsibilities · retrieval approach and grounding enforcement · prompt inventory with versions · structured schemas · tool catalogue and the 6-stage gateway · consensus mechanism and why the rule engine is the third voter · evaluation process · failure handling · cost and latency observed.

## 8. Development AI usage
**Start this file today.** `docs/dev-ai-usage.md`. After each Claude Code session, paste the prompt you used and one line on what you changed about the output. Organise by area: architecture, schema, backend, frontend, queue, retry, voice, triage, consensus, EHR, testing, debugging, docs. Reconstructing this on day 4 is impossible and obvious.

## 9. Known limitations & tradeoffs
The cut list from doc 00, plus anything you dropped along the way. Structure each as: **what was simplified · why · what production would require**.

The PRD says the evaluator must be able to distinguish intentional tradeoffs from broken functionality. Make that distinction impossible to miss — a clear limitations doc converts apparent gaps into evidence of judgement.

## Key deliverables
- [ ] All nine items complete
- [ ] `docs/` index in the README
- [ ] Video uploaded, unlisted link, in the README
- [ ] Every doc written as the feature is built, not retrospectively

## Claude Code prompt (run near the end)
```
Generate the written deliverables from the codebase.

1. docs/architecture.md: one Mermaid system diagram, component responsibilities, the five
   architectural boundaries, and the stack justification.
2. docs/queue-design.md assembled from the implemented code: state machine diagram, the
   priority formula with weights and justification per weight, the worked example, the actual
   claim SQL, the outcome policy table, backoff, callbacks, deadline behaviour, fairness,
   failure recovery, and the Postgres-over-Redis rationale. Every section ends with a
   paragraph justifying the choice.
3. docs/ai-usage.md: models, agents, retrieval, grounding, prompt inventory with versions,
   schemas, tool catalogue and gateway stages, consensus design and the rule-engine
   rationale, evaluation, failure handling, observed cost and latency.
4. docs/known-limitations.md: each item as what was simplified, why, and what production
   would require.
5. Update the README with an index linking every document.
Read the actual code to write these. Do not describe features that are not implemented.
```
