# 09 — AI Architecture, Controlled Tools & Provider Abstraction

**PRD:** §13, §18, §27 · **Depends on:** 01, 02 · **Blocks:** 10–14

---

## Scope
The agent split, the tool gateway every AI action passes through, and the provider interface.

---

## 1. Agent split (PRD §13 forbids one mega-agent)

| Agent | Input | Output | Model |
|---|---|---|---|
| **Voice Intake** | patient context, protocol questions, transcript so far, `partial_state` | next utterance + optional tool call | Claude Sonnet (conversational) |
| **Clinical Triage** | full transcript, retrieved protocol chunks, patient conditions | `TriageResult` (structured) | Claude Sonnet |
| **Second Assessor** | same input, *different prompt framing* | `TriageResult` | GPT (different vendor) |
| **Rule Engine** | structured observations + protocol red-flag list | `TriageResult` | **deterministic code, no LLM** |
| **Escalation Consensus** | the three `TriageResult`s | `EscalationDecision` | deterministic + optional arbiter |
| **Documentation** | transcript, triage, escalation, outcome | `DocumentationRecord` | Claude Haiku (cheap, structured) |

**The rule engine as third voter is the differentiator.** Two LLMs agreeing is weak evidence — they share failure modes. A deterministic protocol matcher fails *independently*, so disagreement is informative. Say this explicitly in your AI usage doc.

---

## 2. The controlled tool gateway (PRD §18)

Mandatory pipeline, no exceptions:

```
AI tool request
  → tool registry lookup (is this tool allowed for this agent?)
  → authorization (does this TenantContext permit this action?)
  → zod schema validation of arguments
  → business-rule validation (window open? campaign running? patient in this tenant?)
  → execution via repository (tenant-scoped)
  → audit_log write
  → structured result back to the AI
```

**Any failure at any stage returns a structured error to the AI, never a thrown exception into the conversation.**

### Tool catalogue

| Tool | Agent | Writes? |
|---|---|---|
| `lookup_patient` | intake, triage | no |
| `lookup_encounter` | triage | no |
| `search_protocol` | intake, triage | no |
| `lookup_previous_outreach` | intake | no |
| `record_observation` | triage | yes |
| `schedule_callback` | intake | yes |
| `record_call_outcome` | intake | yes |
| `create_escalation` | consensus only | yes |
| `request_notification` | consensus | yes |
| `record_communication` | documentation | yes |
| `update_mock_ehr` | documentation | yes |

**Hard rules, enforced in the registry not the prompt:**
- No agent may call `create_escalation` except the consensus system.
- No tool accepts a `hospital_id` argument from the AI — it comes from `TenantContext`. This closes the tenant-crossing attack entirely.
- No tool performs arbitrary SQL, diagnosis, prescription, or protocol modification.

---

## 3. Provider abstraction (PRD §27)

```ts
interface AIProvider {
  id: string
  generate(req: GenerateRequest): Promise<GenerateResult>
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>
}
```
- Implementations: `AnthropicProvider`, `OpenAIProvider`, `MockProvider` (deterministic, for tests and the simulation).
- Every call records to `ai_usage`: agent, purpose, provider, model, prompt version, latency, tokens in/out, estimated cost, success/failure, retry count, validation outcome.
- Timeout 30s, 2 retries with backoff, then circuit-break to `PROVIDER_ERROR` (doc 07 — does not consume a patient attempt).

---

## 4. Prompt management
- `lib/ai/prompts/<agent>/v<N>.ts`, each exporting `{ version, system, build(input) }`.
- The version string is written into `ai_usage` and into every `triage_results` row.
- **This is what makes doc 21's safety eval comparable across changes.** Without prompt versioning the eval report is meaningless.

---

## 5. Context scoping (PRD §18)
Never pass the whole patient history. Each agent gets a purpose-built context builder:
- Intake: demographics, discharge summary, protocol questions, last outreach outcome, `partial_state`
- Triage: transcript + retrieved chunks + active conditions + current medications
- Documentation: transcript + triage + escalation + outcome

Log the context size per call. Say in the AI doc that this is both a cost and a safety decision — irrelevant history is a hallucination surface.

## Key deliverables
- [ ] `lib/ai/providers/` with the three implementations
- [ ] `lib/ai/tools/registry.ts` + per-tool zod schemas + the 6-stage gateway
- [ ] Per-agent tool allowlists
- [ ] `lib/ai/prompts/` with versioned prompts
- [ ] `ai_usage` recording on every call
- [ ] Context builders, one per agent
- [ ] Tests: tool called with a foreign `hospital_id` is rejected; intake agent calling `create_escalation` is rejected; malformed args return a structured error

## Claude Code prompt
```
Implement the AI architecture, tool gateway and provider abstraction per docs 01 and 02.

1. lib/ai/providers: AIProvider interface with generate() and generateStructured<T>().
   Implement AnthropicProvider, OpenAIProvider and MockProvider (deterministic, seeded).
   30s timeout, 2 retries with backoff, then a PROVIDER_ERROR result. Record every call to
   ai_usage with agent, purpose, provider, model, prompt_version, latency, tokens, estimated
   cost, success, validation outcome.
2. lib/ai/tools/registry.ts: each tool declares name, zod argument schema, allowed agents,
   required permission, and handler. callTool(agent, ctx, name, args) runs: registry lookup,
   agent allowlist check, authorization, zod validation, business-rule validation, execution
   through a tenant-scoped repository, audit_log write, structured result.
3. Implement the tool catalogue in this spec. Tools NEVER accept hospital_id from the AI -
   it comes from TenantContext. Only the consensus system may call create_escalation.
4. Any gateway failure returns a structured {error, code, message} to the AI, never throws
   into the conversation loop.
5. lib/ai/prompts/<agent>/v1.ts exporting {version, system, build(input)}. Write the version
   into ai_usage and triage_results.
6. Per-agent context builders that assemble only the fields listed in this spec. Log context
   token size per call.
7. Tests: foreign hospital_id rejected, intake agent blocked from create_escalation,
   malformed args return structured errors, provider timeout produces PROVIDER_ERROR.
```
