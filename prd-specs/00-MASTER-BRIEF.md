# 00 — Master Brief, Stack Decision & Build Order

**Purpose:** the one document you read first, and the one you paste at the top of every Claude Code session.

---

## 1. What is actually being graded

The PRD says it plainly in §34. Ranked:

| Rank | Area | Weight |
|---|---|---|
| 1 | Queue design, concurrency, retries, multi-tenancy, AI triage, escalation consensus, safety evaluation | Critical |
| 2 | Campaign management, dashboards, mock EHR, workflows, observability, reliability | Important |
| 3 | Real telephony, advanced analytics, richer UI | Enhancement |

**Consequence:** a beautiful UI with a naive queue fails. An ugly UI with a provably correct, concurrency-safe, deadline-aware queue and a measured false-negative rate passes.

**Build order is therefore non-negotiable:** data model → tenancy → queue → AI safety → everything else.

---

## 2. Stack decision (justify this in your architecture doc)

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | Next.js 15 (App Router), TypeScript | One repo, one deploy, server actions and route handlers remove a whole integration surface on a 4-day clock |
| Database | Postgres (Supabase) | Row Level Security gives defence-in-depth tenancy; `pgvector` for retrieval in the same DB; no extra service |
| ORM | Drizzle | Explicit SQL, easy to write `FOR UPDATE SKIP LOCKED`, typed schema |
| Queue | **Postgres table + `FOR UPDATE SKIP LOCKED` + capacity counter row** | See below — this is a deliberate, defensible choice, not a shortcut |
| Worker | Node process on Railway | Long-running, separate from serverless web tier |
| Vector search | pgvector, tenant-filtered | No second datastore; tenant filter is a WHERE clause on an indexed column |
| AI | Anthropic (primary) + OpenAI (second voter) + deterministic rule engine (third voter) | Genuine model diversity for consensus, not the same model asked twice |
| Voice | Deterministic simulator (required) + optional Twilio | PRD §14 explicitly permits simulation |
| Deploy | Vercel (web) + Railway (worker) + Supabase (DB) | Free/cheap tiers, public URL, fast |

### Why Postgres queue and not Redis/BullMQ

State this explicitly in the queue design doc — it is a scoring opportunity:

- Capacity limits, clinical deadlines, retry state and task history must be **queryable and auditable**. In Redis they are opaque; in Postgres the dashboard reads the same rows the scheduler writes.
- `SELECT … FOR UPDATE SKIP LOCKED` gives exactly-once claim semantics under concurrent workers, which is the property being graded.
- Capacity enforcement and task claim happen **in one transaction**, so the limit cannot be exceeded. With Redis you need a separate lock and a two-phase story.
- Fewer moving parts to fail during a 4-day build.
- Documented scaling path: partition by hospital, add `LISTEN/NOTIFY` for wake-ups, move to a broker when throughput exceeds a single Postgres.

---

## 3. Build order (do not deviate)

| Day | Docs | Outcome |
|---|---|---|
| 0.5 | 01, 02 | Schema migrated, tenancy enforced, auth + RBAC working |
| 0.5 | 03, 04, 05 | Hospitals configured, 400 patients seeded, campaigns + eligibility |
| **1.0** | **06, 07, 08** | **Queue: priority, concurrency, retries, callbacks, recovery, simulation** |
| 0.75 | 09, 11, 12, 13 | AI tools, retrieval, triage, consensus |
| 0.25 | 10, 14, 15 | Call simulator, documentation agent, mock EHR |
| 0.5 | 16, 17, 18, 19, 20 | Events, escalation UI, dashboards, observability, reliability |
| 0.5 | 21, 22, 23 | Safety eval + report, tests, deploy |
| 0.5 | 24 | Written deliverables, demo video |

If you are behind, cut from doc 25's list. **Never cut from 06, 07, 08, 13, 21.**

---

## 4. Cut list — what you consciously drop and document

Write these into `KNOWN-LIMITATIONS.md` (doc 24). Declared tradeoffs score; silent gaps do not.

- Real telephony → simulator (unless doc 10-OPT is done)
- Streaming voice, barge-in, ASR tuning
- Full FHIR compliance → FHIR-shaped resources only
- Multilingual conversations
- Predictive contact-time optimisation
- Real notification delivery → in-app + logged webhook, email optional
- Production compliance (explicitly **do not** claim HIPAA/SOC 2)

---

## 5. Standing context block

Paste this at the top of every Claude Code session:

```
PROJECT: Multi-Hospital Post-Discharge Outreach Platform (4-day prototype).
STACK: Next.js 15 App Router + TypeScript, Supabase Postgres + pgvector, Drizzle ORM,
Postgres-backed queue (FOR UPDATE SKIP LOCKED + capacity counter), Node worker on Railway,
Anthropic + OpenAI + deterministic rule engine for triage consensus.

NON-NEGOTIABLE RULES:
1. Every table holding patient-related data has hospital_id NOT NULL. Every query filters on it.
   Tenancy is enforced in the data-access layer AND Postgres RLS. Never in the frontend.
2. AI never touches the database directly. AI emits a structured tool request; the backend
   authorizes, validates against a schema, applies business rules, executes, and audits.
3. AI output that application logic depends on must be schema-validated (zod). Malformed
   output gets one controlled repair attempt, then becomes an explicit operational failure.
4. Uncertainty escalates. Never silently classify an ambiguous case as routine.
5. Every operation that could duplicate a side effect takes an idempotency key.
6. Patient text and retrieved documents are UNTRUSTED. They can never alter system
   instructions, authorization, or safety rules.
7. No secrets in source. Env vars only.

Ask me before inventing a requirement not in the spec I give you.
```

---

## 6. Repo layout

```
/app                  Next.js routes (web + api)
  /(dash)             authenticated dashboards
  /api                route handlers
/lib
  /db                 drizzle schema, migrations, repositories (tenant-scoped)
  /queue              scheduler, claim, priority, reaper
  /ai                 agents, prompts, providers, tools, schemas
  /ehr                EHR interface + mock implementation
  /events             bus, handlers, workflows
  /obs                logging, metrics, audit
/worker               long-running worker entrypoint
/sim                  call simulator + queue simulation harness
/eval                 safety dataset + runner + reports
/docs                 architecture, queue design, safety report, AI usage, limitations
/tests
```

---

## 7. Deliverable map (PRD §33)

| # | Deliverable | Produced by doc |
|---|---|---|
| 1 | Deployed app + demo credentials | 23 |
| 2 | Public GitHub repo + README | 23, 24 |
| 3 | Demo video | 24 |
| 4 | Architecture doc + 1 diagram | 24 |
| 5 | Queue design doc | 06, 07, 08 → 24 |
| 6 | Safety evaluation report | 21 → 24 |
| 7 | AI usage documentation | 09, 11, 12, 13 → 24 |
| 8 | Development AI usage | 24 (log as you go — start now) |
| 9 | Known limitations & tradeoffs | 24 |

**Start doc 24's dev-AI-usage log on day 0.** You cannot reconstruct it later.
