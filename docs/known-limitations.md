# Known Limitations & Tradeoffs

Each item: **what was simplified · why · what production would require.**

## From the original cut list

- **Real telephony → deterministic scripted simulator.** PRD §14 explicitly permits this. Production would require a Twilio (or equivalent) integration behind the same `PatientResponder` interface the simulator already implements — `prd-specs/10-OPT-real-telephony.md` specs this out but it was not built; the interface boundary exists specifically so that swap doesn't touch the conversation state machine, detectors, or anything downstream of it.
- **Streaming voice, barge-in, ASR tuning → not built at all.** These require a real telephony leg to exist first (above). Production would require a streaming ASR/TTS pipeline and a conversation loop that can be interrupted mid-turn, which the current turn-based state machine doesn't model.
- **Full FHIR compliance → FHIR-shaped resources only.** Patient/Encounter/Condition/Medication/CarePlan tables mirror FHIR's field shapes for readability, but there's no FHIR server, no `Bundle` resources, no SMART-on-FHIR auth. Production would require an actual FHIR server (e.g. HAPI) or a certified EHR vendor integration.
- **Multilingual conversations → not built.** English only, one prompt language, one set of scripted personas. Production would require per-language prompts, a language-aware TTS/ASR pair, and translated protocol content — not just a translation pass over the existing English prompts, since clinical phrasing safety review would need to happen per language.
- **Predictive contact-time optimisation → not built.** Calling hours are a static per-hospital config (doc 03), not learned from response-rate history. Production would require enough real call outcome data to model against, which a 6-day build with simulated calls cannot produce honestly.
- **Real notification delivery → in-app + logged only.** `notifications` rows are created and displayed; no real email/SMS/webhook delivery. Production would require an actual provider (SES, Twilio, etc.) behind the same `request_notification` tool contract, which was deliberately fixed early (doc 09) so this swap doesn't change callers.
- **Production compliance → explicitly not claimed.** This system is not HIPAA- or SOC 2-compliant and should not be described as such. RLS, audit logging, and PHI redaction in logs are real, meaningful controls, but they are a fraction of what a compliance program requires (BAAs, encryption key management, incident response, access review cadence, etc.).

## Discovered during the build, not in the original cut list

- **The always-on worker uses generic follow-up questions and red flags for every call, not each patient's actual assigned protocol** (`worker/index.ts`). Wiring doc 11's full tenant-aware retrieval into the worker is a larger integration than the deployment doc's scope justified in the time remaining. Production would require the worker to look up each patient's assigned protocol and retrieve its actual follow-up questions, the same way `npm run sim` does for local demos of a single protocol.
- **The AI cost guard (`lib/ai/providers/select-provider.ts`) has no caller yet.** The three-layer guard (per-call token cap, no-API-key fallback, daily-spend ceiling) is implemented and unit-tested, but every agent invocation in this build deliberately goes through `MockProvider` (doc 10/13's own scope decision — no real API keys are configured in this environment), so `selectProvider()` is never actually invoked in the live path. Production would require wiring real agent call sites to call `selectProvider()` instead of constructing a provider directly.
- **No real AI cost/latency was ever observed.** Doc 24 item 7 asks for "cost and latency observed" — none exists, honestly, because nothing in this build ever called a paid provider. `ai_usage` rows and `recordAiUsage()` are real and would populate correctly the moment a real provider runs; the number today is zero calls, not a redacted or rounded number.
- **`demo:reset` is a script, not a website button.** `app_user` (the app's own runtime DB connection) deliberately has no DELETE/TRUNCATE grant — a real, intentional security boundary. A live "reset demo data" button would need to either weaken that grant or add a privileged backend path just for this convenience; neither was worth doing under time pressure, so reset is `npm run demo:reset`, run with the admin connection, same pattern as `db:migrate`.
- **Tests and the running app share one live Supabase project** (`vitest.config.ts`). This kept the build simple (no second database to provision or keep migrated) but means every test run leaves fixture hospitals behind with no automatic cleanup, and integration tests inherit the pooler's multi-second query latency. Production — or even a longer-lived version of this project — would need a separate test database (or at minimum an `afterAll` cleanup per test file) to stop this compounding.
- **The safety evaluation (doc 21) runs against pre-authored assessor outputs, not live models**, for the same no-API-key reason as above. The rule engine and consensus algorithm being evaluated are the real, production code — only the two LLM assessors' outputs are canned per case. This is disclosed in `docs/safety-evaluation.md` as a methodology limit, not hidden.

## Two doc 24 deliverables that need you, not more code

- **Deployed URL** — not deployed yet. `docs/deployment.md` has the exact steps; it needs your own Vercel, Railway, and Supabase accounts, which nothing running in this environment can create on your behalf.
- **Demo video** — not recorded. `prd-specs/24-written-deliverables.md` §3 has the full shot list (segments, timings, what each must show) ready to follow once there's a deployed instance to record against.

## Doc 25 — optional features: what's in, what's declined

**Tier A (highest return) — already built as part of the core spec, not bolted on separately:**
- Queue "why this order?" explainer — the score-breakdown popover on the Campaign Manager dashboard (doc 18).
- Self-verifying simulation assertions (doc 08 R7).
- Chaos test (doc 20).
- Rule engine as third assessor (doc 13) — the core differentiator, never at risk of being cut.
- Transcript-reference hallucination check (doc 12 R4).
- Reduced-assessor escalation on provider degradation (doc 20 R3).

**Tier B/C — not attempted.** Out of the 6-day time budget once docs 01–23 (the required, non-optional scope) were complete. None of these were started, so none are half-built or silently missing pieces of a claimed feature — they simply don't exist yet: real telephony beyond the simulator, an escalation notification chain with timeout, a dedicated FHIR resource viewer (the patient detail page already shows FHIR-shaped data, just not as a dedicated viewer), prompt-version A/B in the eval runner, a dedicated cost/latency-per-agent dashboard, SSE-based live capacity updates (the dashboard polls every 5s instead, per doc 18 R6's own stated tradeoff), multilingual intake, sentiment scoring, learned calling-window optimisation, SMS fallback, patient education content, reviewer workload balancing, a risk-prediction model, protocol version diffing.

**Tier D — explicitly declined:**
- Streaming voice with barge-in — requires a real telephony leg (see above); out of scope by construction.
- Full FHIR compliance — a FHIR-shaped data model was the deliberate scope; a compliant FHIR server is a multi-week integration on its own.
- Real HIPAA controls — this is a hackathon prototype on shared/free-tier infrastructure; claiming HIPAA compliance here would be false, not aspirational.
- Horizontal worker autoscaling demo — one worker process is sufficient to demonstrate the architecture; the queue's `FOR UPDATE SKIP LOCKED` claim already makes multiple workers safe (proven by the concurrency tests), but standing up and demoing a second worker instance wasn't worth the time against a single-worker Railway deployment.
- Mobile app — the admin UI is a responsive web app; a native app is a different product surface with its own scope.
- Production monitoring stack — `/api/health` and `docs/runbook.md` cover doc 19/20's actual requirements; a full Prometheus/Grafana-style stack is infrastructure a 6-day prototype doesn't need to prove the underlying reliability work is real.
