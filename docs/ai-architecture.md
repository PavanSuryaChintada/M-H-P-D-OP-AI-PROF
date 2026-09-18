# AI Architecture, Tool Gateway & Provider Abstraction (Doc 09)

## Agent split (PRD §13)

Six agents, none of them a mega-agent: `voice_intake`, `clinical_triage`, `second_assessor`, `rule_engine`, `escalation_consensus`, `documentation`. `rule_engine` is deterministic code, not an LLM call — it exists as an `AgentName` for the tool allowlist system even though it never calls a provider. The rule engine as third voter (doc 13) is the differentiator PRD §13 calls out explicitly: two LLMs agreeing is weak evidence since they share failure modes; a deterministic protocol matcher fails independently, so disagreement between it and the LLMs is informative in a way LLM-vs-LLM disagreement isn't.

## The controlled tool gateway (`lib/ai/tools/registry.ts`)

Every AI action goes through `callTool(agent, ctx, name, rawArgs)` — there is no other path from agent code to a repository. Six stages, exactly per spec:

1. **Registry lookup** — unknown tool name → `UNKNOWN_TOOL`.
2. **Agent allowlist** — each `ToolDefinition` declares which agents may call it. `create_escalation` and `request_notification` only allow `escalation_consensus`; no other agent can reach them, checked here, not in a prompt.
3. **Tenant-violation check** — before anything else touches the args, the *raw* payload is checked for a `hospitalId`/`hospital_id` key and rejected (`TENANT_VIOLATION`) if present. This is on top of the structural guarantee that no tool's zod schema even has that field — defense in depth, not either/or.
4. **Authorization** — `requiredPermission` (when set) is checked against `lib/auth/permissions.ts`'s existing matrix.
5. **Zod validation** — malformed or missing args → `INVALID_ARGS`, never a thrown exception.
6. **Execution** — the handler runs against a real repository function. A handler that throws `BusinessRuleError` (domain-level rejection — patient not in this tenant, window closed, etc.) becomes a structured `BUSINESS_RULE_VIOLATION`; anything else becomes `EXECUTION_ERROR`. Nothing escapes as an unhandled exception into the conversation loop.
7. **Audit log write** — every `writes: true` tool call writes to `audit_log` after the handler succeeds.

**Verified** (`tests/ai-tool-gateway.test.ts`): a tool call carrying `hospitalId` or `hospital_id` in its raw args is rejected before validation; `voice_intake` calling `create_escalation` is rejected at the allowlist stage while `escalation_consensus` calling the same tool gets past every stage up to execution; malformed/missing args return `INVALID_ARGS`, not a throw.

### Tool catalogue and what backs it today

Every table the catalogue's tools write to or read from already existed in doc 01's schema (`protocols`, `escalations`, `notifications`, `communications`, `events`) — doc 09 only needed repository functions, not new tables. Three of the eleven tools intentionally call into code that isn't fully built yet, with the tool's *contract* fixed now so later docs extend the query, not the interface:

- `search_protocol` does a plain `ILIKE` keyword match over `protocols.content` today. Doc 11 replaces this with pgvector similarity search over `knowledge_chunks.embedding` without changing the tool's args or result shape.
- `update_mock_ehr` writes an outbound `communications` row today. Doc 15's `MockEHRClient` (with failure injection) is the real implementation; this tool's contract doesn't change when doc 15 lands.
- `request_notification` creates a `PENDING` `notifications` row. Doc 16's dispatcher is what actually sends it.

`schedule_callback` and `record_call_outcome` both call directly into doc 07's `recordCallOutcome` — the gateway doesn't reimplement queue logic, it's a controlled front door onto the same code the scheduler uses.

## Provider abstraction (`lib/ai/providers/`)

`AIProvider` — `generate()` and `generateStructured<T>()` — with three implementations: `AnthropicProvider`, `OpenAIProvider`, `MockProvider`. Structured output on both real providers is enforced via forced tool-use/function-calling with the zod schema converted to JSON Schema (`z.toJSONSchema`), and the model's output is **re-validated against the same zod schema** before it's trusted — a provider claiming schema conformance is not itself proof of conformance. `MockProvider` is deterministic: structured calls are driven by a caller-supplied queue of canned responses (so a test or the doc 08-style simulation controls exactly what the "model" says next), and `generate()` falls back to a hash-derived string when no queue is supplied.

### The managed-call wrapper (`lib/ai/providers/managed-call.ts`)

Doc 09 §3's policy — 30s timeout, 2 retries with backoff, then circuit-break — lives in exactly one place: `runGenerate()`/`runStructured()`. No agent calls a provider directly; they call these, which apply the timeout/retry uniformly regardless of which provider or agent, and record every attempt (success or exhausted-retries failure) to `ai_usage` via `recordAiUsage`. A validation failure (the model's output doesn't parse against the schema even after retries) is recorded with `validationOutcome: "failed"`, distinct from a raw provider/network failure.

**Verified:** a provider whose `generate()` never resolves returns `{ok: false, code: "PROVIDER_ERROR"}` after `timeoutMs` × the retry budget, not a hung promise; a `MockProvider` fed only schema-violating responses does the same; a `MockProvider` fed a valid response returns validated, typed data.

**Schema gap found and fixed:** doc 01's original `ai_usage` table (`agent, provider, model, purpose, latency_ms, success, token_input, token_output, estimated_cost_usd, error`) predates doc 09's spec, which explicitly asks for prompt version, retry count, and validation outcome to be recorded too. Added `prompt_version`, `retry_count` (default 0, not null), and `validation_outcome` via an additive migration (`0007_complex_zeigeist.sql`) rather than silently dropping those fields from the design — this is exactly what makes doc 21's safety eval able to compare report runs against the prompt version that produced them.

## Prompts (`lib/ai/prompts/<agent>/v1.ts`)

Each exports `{version, system, build(input)}`. `version` is written into `ai_usage` on every call. Every LLM-facing prompt (`voice-intake`, `clinical-triage`, `second-assessor`, `escalation-consensus`, `documentation`) includes `UNTRUSTED_CONTENT_NOTICE` (doc 02) once, restates the specific hard safety rules from its own spec doc (never diagnose/prescribe, the fixed refusal line, the emergency-stop behavior for intake; hallucination-guard instructions for the two triage assessors; the "cannot downgrade an escalation" constraint for the consensus arbiter), and — deliberately — the two triage prompts (`clinical-triage` protocol-first, `second-assessor` symptom-first) differ in framing on purpose, not just in which vendor calls them, per doc 13 §1's point about independent failure modes.

## Context builders (`lib/ai/context/builders.ts`)

One per agent, scoped to exactly the fields that agent's spec names — never the whole patient history:

- **Intake:** demographics, discharge summary, last outreach outcome, whatever `partial_state` the caller has.
- **Triage:** transcript + retrieved chunks (both supplied by the caller — doc 10's call record and doc 11's retrieval respectively, since scoping the clinical side and owning the conversation/retrieval pipelines are different jobs) + active conditions + current medications.
- **Documentation:** transcript + triage + escalation + outcome.

Every builder returns `contextTokens` (chars/4 estimate) alongside its data, so a caller logs context size per call per §5 — a cost decision and a safety one, since irrelevant history is a hallucination surface.

## What doc 09 does not cover

- The actual conversation loop, call record, and call simulator — doc 10.
- Real semantic protocol retrieval — doc 11.
- The Clinical Triage / Second Assessor / Rule Engine agents actually being invoked end to end, and the transcript-quote hallucination check enforced at runtime — doc 12.
- The consensus algorithm's 8 ordered rules and the reviewer UI — doc 13.
- The Documentation agent actually being invoked, and the mock EHR's failure injection — doc 14/15.
