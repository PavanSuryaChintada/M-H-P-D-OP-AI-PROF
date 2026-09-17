# 25 — Optional Features, Ranked by Marks per Hour

**PRD:** §31 Should-Have / Nice-to-Have

> PRD §31: *"Optional functionality should never come at the expense of queue correctness or patient safety."*
> Nothing here starts until docs 06, 07, 08, 12, 13, 21 are green.

---

## Tier A — highest return, do these first if you have hours left

| Feature | Effort | Why it scores |
|---|---|---|
| **Queue "why this order?" explainer** | 1h | Directly answers PRD §10's demand for a justified algorithm, live, in the UI. Nobody else will have it. |
| **Self-verifying simulation assertions** (doc 08 R7) | 1h | Turns your demo into proof rather than animation |
| **Chaos test** (doc 20) | 2h | One test that demonstrates the entire reliability section |
| **Rule engine as third assessor** (doc 13) | 2h | Already in the core spec — but if you were tempted to cut it, don't. It is the strongest single differentiator in the AI layer. |
| **Transcript-reference hallucination check** (doc 12 R4) | 1.5h | Cheap, rare, and directly addresses the PRD's grounding requirement |
| **Reduced-assessor escalation** (doc 20 R3) | 0.5h | Shows you thought about degraded-mode safety |

## Tier B — strong, if a half-day is free

| Feature | Effort | Notes |
|---|---|---|
| Real telephony (doc 10-OPT) | 3h | Most memorable demo moment. Only after Tier A. |
| Escalation notification chain with timeout (doc 16 R5) | 2h | PRD gives this as its own example — implementing it literally is an easy mark |
| FHIR-shaped resource viewer | 1.5h | Makes the healthcare data model visible instead of merely claimed |
| Prompt version A/B in the eval runner | 2h | Run the dataset against two prompt versions, show the FN-rate delta. Very strong evidence of engineering rigour. |
| Cost/latency dashboard per agent | 1.5h | PRD §27 asks for it and most will skip it |
| Live capacity gauge via SSE | 1.5h | Only if polling feels laggy in the video |

## Tier C — only if genuinely ahead

Multilingual intake (one extra language) · sentiment / conversation-difficulty scoring · intelligent calling-window learning · SMS fallback on repeated no-answer · patient education content delivery · reviewer workload balancing · risk-prediction model on discharge features · protocol version diffing.

## Tier D — explicitly decline, and say why

Streaming voice with barge-in · full FHIR compliance · real HIPAA controls · horizontal worker autoscaling demo · mobile app · production monitoring stack.

Put these in `known-limitations.md` as conscious exclusions with a one-line rationale each. **A declined feature with a reason reads as judgement. The same feature missing with no comment reads as an oversight.**

---

## The one-line rule
Before starting anything in this document, ask: *does doc 06's concurrency test still pass, and does `eval:safety` still report a false-negative rate?* If either is no, close this file and go back.
