# AI Prompts Used for Development

Representative prompts for each tool listed in
[`docs/ai-tools-and-usage.md`](ai-tools-and-usage.md), grouped by the role
that tool played. These are illustrative of the *kind* of prompt used for
each tool's job, not a full transcript — the full, verbatim, session-by-session
Claude Code prompt log lives in [`docs/dev-ai-usage.md`](dev-ai-usage.md).

## OpenSpec — architectural planning & design

```
Take this PRD and split it into a sequenced spec pack: one self-contained
document per feature area, ordered by build dependency rather than numeric
order. Each doc should carry its own standing context block so a session
starting cold can pick it up without re-reading the whole PRD.
```

```
Generate a PRD/TRD/DRD breakdown and a six-day workflow roadmap from this
brief. Tag every requirement Critical / Important / Enhancement so scope can
be cut safely under time pressure without touching the critical path.
```

This is what produced the 26-document pack in [`prd-specs/`](../prd-specs/) —
one doc per feature (data model, auth, queue core, AI architecture, triage,
consensus, EHR, events, dashboards, reliability, testing, deployment, etc.),
each self-contained enough to hand to a single build session.

## Claude Code — backend development

```
Implement doc 06 exactly: the priority formula and weights as specified, the
single-transaction claim with FOR UPDATE SKIP LOCKED, and the worked example
as a test case. Don't reinterpret the formula — follow the spec's SQL
literally.
```

```
Doc 13's consensus algorithm: implement the 8 rules in the exact order
specified. If a rule is structurally unreachable given the ordering, say so
in the code and the docs rather than silently reordering to make it
reachable.
```

Full real prompts, one per build session, are in
[`docs/dev-ai-usage.md`](dev-ai-usage.md) — including the schema gaps and
bugs each prompt's resulting code surfaced.

## Antigravity & Komboi — frontend development

```
Build the escalation review screen: patient summary, transcript, all three
assessments (two LLM-shaped, one rule-engine) side by side with the firing
consensus rule labeled, expandable protocol evidence, and an action bar
(acknowledge → assign → resolve with a structured outcome).
```

```
The nav should differ by role — Clinical Reviewer only sees
Overview/Patients/Escalations. Generate the layout component so the nav is
driven by the signed-in user's role, not a static list.
```

## Devin — testing

```
Write a concurrency test: 50 parallel workers competing for 10 capacity
slots, repeated 3 times. Assert capacity is never exceeded and there are
zero duplicate claims on any task.
```

```
Generate persona-based test scripts for the call simulator covering
cooperative, terse, refuser, wrong_person, advice-seeker, and emergency
patients — one test per persona asserting its documented expected outcome.
```

## Cline — automation testing & CI

```
Set up a GitHub Actions workflow: spin up a disposable pgvector Postgres
service, run typecheck, lint, a secret scan, migrations, RLS policy setup,
then the full test suite. Fail the build if any step fails.
```

```
Add a step that scans tracked files for committed API key patterns
(Anthropic, OpenAI, Supabase service-role, AWS) before the test job runs.
```

## Gemini — documentation

```
Write docs/queue-design.md from the implemented code, not from the spec:
state machine diagram, the priority formula with the reasoning for each
weight, the worked example, the actual claim SQL, backoff/callback/deadline
rules, and why Postgres was chosen over Redis. End every section with a
paragraph justifying the choice.
```

```
Summarize docs/ai-architecture.md into a shorter, product-facing page for a
non-engineering reviewer: what the AI does, why three independent voters
instead of one model asked twice, and where the human stays in the loop.
```

## OpenRouter — API layer for calling LLM providers

Not a prompt-driven authoring tool — it's the routing layer itself. The
"prompt" here is closer to a configuration decision:

```
Route both triage assessors through one OpenAI-compatible endpoint that can
reach either vendor's models, so a single API key supplies genuine model
diversity (Claude for the primary assessor, GPT for the secondary) without
wiring two separate vendor SDKs.
```

## ChatGPT Go — fixing Railway deployment issues

```
The worker service on Railway is crash-looping right after deploy — here's
the build log and the start command. What's failing, and what's the fix?
```

```
Railway's environment variables aren't reaching the worker process at
runtime the way they do locally — walk through the difference between
build-time and runtime env var injection on this platform.
```

## Supabase bot — fixing SQL migration & RLS errors

```
This migration fails with a NOT NULL constraint violation against existing
rows in a live table — what's the safe way to backfill a default before the
column becomes NOT NULL?
```

```
A newly added table is silently returning zero rows to every query even
though the data is there — row-level security is on with no policy defined.
What's the fix?
```
