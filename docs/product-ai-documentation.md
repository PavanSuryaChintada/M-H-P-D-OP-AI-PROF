# Product AI Documentation

This page describes **what the AI in this product does and why**, for a
reviewer who wants the product story without the implementation detail. It
is not the same thing as [`docs/ai-tools-and-usage.md`](ai-tools-and-usage.md),
which documents the AI *coding* tools used to build this repository —
that's a build-process concern, this is a product-capability one. For full
technical depth on anything below, see `docs/ai-architecture.md`,
`docs/clinical-triage.md`, `docs/escalation-consensus.md`,
`docs/protocols-and-retrieval.md`, and `docs/safety-evaluation.md`.

## What the AI actually does, end to end

1. **Voice intake** — a scripted, code-driven conversation state machine
   (not a freeform chatbot) calls a discharged patient, asks their
   protocol's follow-up questions, and detects emergencies, refusals, and
   wrong-number/wrong-person cases with deterministic keyword rules that run
   independently of any model — so a safety-critical decision like "stop
   this call" is never left to an LLM to get right live.
2. **Clinical triage — two independent LLM assessors, not one asked
   twice.** Every completed call is assessed by two differently-framed
   prompts on two different model vendors (protocol-first vs.
   symptom-first), each grounded in the actual transcript and the patient's
   real protocol content (retrieved per-hospital, never across hospitals).
3. **A third, deterministic assessor — the rule engine.** A keyword/red-flag
   matcher over the same protocol content, with no LLM involved. It cannot
   hallucinate and cannot be prompt-injected, so when it disagrees with the
   two LLMs, that disagreement is genuinely informative rather than noise
   from three correlated guesses.
4. **Consensus, not a vote of 2-out-of-3.** An 8-rule, ordered decision
   procedure combines all three opinions. Any `urgent` verdict, any rule-engine
   red-flag hit, or any assessor's uncertainty escalates on its own — the
   *only* path that does **not** escalate is unanimous, confident, complete
   agreement that everything is routine. Everything else defaults to a
   human.
5. **Human review, always in the loop for anything non-routine.** Every
   escalation shows a reviewer all three assessments side by side, which
   rule fired, and the protocol evidence behind it, before a human takes any
   action.
6. **Documentation** — a fourth agent turns the completed call into a
   structured clinical note, checked against the transcript so it can't
   report a symptom that was never actually mentioned, then writes it to the
   (mock) EHR.

## Why three independent voters instead of one better model

Two LLMs agreeing is weak evidence on its own — they can share the same
blind spots and the same failure modes. A **structurally different** third
opinion (a deterministic matcher that succeeds and fails for completely
different reasons than a language model does) is what makes agreement
actually mean something and disagreement actually useful. Measured directly:
in the safety evaluation, the rule engine alone is 100% correct on every
case containing a known red-flag phrase but mechanically wrong on every
ambiguous or incomplete case (it has no concept of "I'm not sure"); the two
LLM assessors catch exactly those cases. Neither kind of assessor alone
would be safe — see `docs/safety-evaluation.md` for the full breakdown and
three worked disagreement examples with real transcript quotes.

## Where the human stays in the loop

- The AI can recommend escalation; **nothing in the system can suppress or
  downgrade one.** There is no tool, endpoint, or parameter that turns an
  "escalate" verdict into a "don't" — verified structurally, not just by
  policy.
- A clinical reviewer resolves every escalation with a structured outcome;
  the AI never closes its own case.
- Every AI output that touches a patient record goes through a controlled
  tool gateway (six checks: allowlist → tenant check → authorization →
  schema validation → execution → audit log) — an agent cannot reach a
  database table on its own, regardless of what a prompt says.

## Guardrails against the AI itself going wrong

- **Never diagnoses or prescribes.** Every LLM-facing prompt restates this
  as a hard rule; the voice-intake agent has a fixed refusal line for any
  advice request and stops immediately on any detected emergency.
- **Grounded, not fabricated.** Triage output is checked against the actual
  call transcript — a symptom or quote the model invents but the patient
  never said is rejected, not silently accepted.
- **Tenant-isolated retrieval.** A hospital's protocol content is never
  retrievable by another hospital's calls, even under a query deliberately
  built to try.
- **Prompt-injection resistant by structure, not by hope.** The voice-intake
  conversation is a deterministic state machine — patient speech is never
  interpreted as instructions, so there is no text a caller could say that
  redirects what the system does next. Untrusted content elsewhere (call
  transcripts fed to the triage/documentation agents) is explicitly
  delimited and labeled to every model that sees it.
- **Fails closed, not open.** A provider timeout, an unparseable model
  response, or an assessor that errors out all route to "escalate to a
  human" (consensus rule 4), never to "assume it's fine."

## Honest boundaries of what's built

- The two LLM triage assessors are described here as they're designed to
  run; whether they've actually made a *live* paid model call in this build
  is a separate, deliberately disclosed fact — see
  `docs/known-limitations.md` and `docs/ai-architecture.md`'s "Observed cost
  and latency" section. The consensus algorithm and rule engine being
  evaluated are the real, unmodified production code either way.
- Real telephony, streaming voice, and multilingual conversations are not
  built — the conversation runs against a scripted call simulator that
  exercises the same orchestration a real phone call would. See
  `docs/known-limitations.md` for the full list of what's simplified, why,
  and what production would need.
