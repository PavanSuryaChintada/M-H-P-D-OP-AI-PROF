# Multi-Hospital Post-Discharge Outreach Platform

AI-powered patient follow-up, clinical triage, and hospital outreach operations platform.

**Deployed URL:** not yet deployed — see `docs/deployment.md` for the exact steps (Vercel account + Railway account + Supabase project, all under your own accounts; nothing here can create those on your behalf).

## Architecture

```
                    ┌─────────────┐
   Browser  ───────▶│  Next.js    │  Vercel (web + API routes, incl. /api/mock-ehr/*)
                     │  (this repo)│
                     └──────┬──────┘
                            │
              ┌─────────────┼─────────────┐
              ▼                           ▼
      ┌───────────────┐          ┌────────────────┐
      │ Supabase       │◀────────│ Worker process  │  Railway (always-on)
      │ Postgres +     │         │ worker/index.ts │  scheduler tick, reaper,
      │ pgvector + RLS │         │                 │  event dispatcher, EHR retry
      └───────────────┘          └────────────────┘
```

Mock EHR is not a separate service — it's route handlers inside this same Next.js app (`app/api/mock-ehr/*`), called by `lib/ehr/client.ts`. See `docs/deployment.md` for why the worker has to be a separate always-on process rather than something Vercel can run.

## Demo credentials

Seeded via `npm run seed:demo-users` (needs `SUPABASE_SERVICE_ROLE_KEY` in `.env`). Password is the same for all four:

| Role | Email | Password |
|---|---|---|
| Platform Admin | `platform-admin@demo.mhpd.local` | `Demo1234!` |
| Hospital Admin | `hospital-admin@demo.mhpd.local` | `Demo1234!` |
| Campaign Manager | `campaign-manager@demo.mhpd.local` | `Demo1234!` |
| Clinical Reviewer | `clinical-reviewer@demo.mhpd.local` | `Demo1234!` |

Hospital Admin, Campaign Manager and Clinical Reviewer are all scoped to the seeded "Demo General Hospital"; Platform Admin is not hospital-scoped (PRD §3).

These are prototype-only demo accounts on a non-production Supabase project — not real patient data, not a production credential.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase project's connection details (see the comments in that file for the IPv4-pooler gotcha on new Supabase projects).
3. `npm run db:migrate` then `npm run db:rls` (applies `lib/db/rls.sql` — reads the `app_user` password from `DATABASE_URL_POOLED`).
4. `npm run seed:demo-users`
5. `npm test`, `npm run dev`

**Run these from the project root** (this directory) — not from a subfolder like `app` or `app/admin`, which are route folders inside the app, not separate projects.

### Other useful commands

| Command | What it does |
|---|---|
| `npm run seed:demo` | Full demo dataset: migrate + RLS + hospitals + users + protocols + patients, in one shot |
| `npm run sim` | Doc 08's queue simulation — claim/call/retry/reap end to end against real fixtures |
| `npm run eval:safety` | Doc 21's safety evaluation harness — 60 cases, prints the false-negative rate |
| `npm run demo:reset` | Truncates operational data and re-seeds fresh demo patients (see `docs/deployment.md`) |
| `npm run worker` | Runs the always-on worker locally (`worker/index.ts`) — what Railway runs in production |

### Known limitations

See `docs/testing.md` ("Tier 3 — nice, deliberately not done") and each doc's own write-up in `docs/` for what was cut and why, per PRD §34's own instruction to cut and say so rather than claim more than was built.

## Testing

See `docs/testing.md` for what's covered, by which test, and what's deliberately not tested. Latest full run (all Tier 1/2 requirements from doc 22):

```
Test Files  41 passed (41)
     Tests  225 passed (225)
```

Safety evaluation harness (doc 21) — `npm run eval:safety`: 60 cases, 0.00% false-negative rate, all 6 adversarial (prompt-injection) cases unaffected. Full report in `docs/safety-evaluation.md`.

---

# Spec Pack — Multi-Hospital Post-Discharge Outreach Platform

26 segmented specs for a 3–4 day solo prototype. Each is self-contained and ends with a copy-paste Claude Code prompt.

## How to use
1. Read `00-MASTER-BRIEF.md`. It contains the stack decision, the build order, and a **standing context block** to paste at the top of every Claude Code session.
2. Work the docs in build order, not numeric order. Doc 00 §3 gives the schedule.
3. One doc = one Claude Code session. Paste the standing context block, then the doc's prompt.
4. Log every prompt you use into `docs/dev-ai-usage.md` as you go — it is submission deliverable 8 and cannot be reconstructed later.

## Order of importance (PRD §34)
**Critical:** 01, 02, 06, 07, 08, 12, 13, 21
**Important:** 03, 04, 05, 09, 11, 14, 15, 16, 17, 18, 19, 20
**Enhancement:** 10-OPT, 25

If you fall behind, cut from doc 25's list and document the cut. Never cut 06, 07, 08, 13 or 21.

## Index

| Doc | Title | Priority | Spec | Write-up |
|---|---|---|---|---|
| 00 | Master brief, stack, build order | read first | [spec](prd-specs/00-MASTER-BRIEF.md) | — |
| 01 | Data model & multi-tenancy | Critical | [spec](prd-specs/01-data-model-and-tenancy.md) | [docs/data-model.md](docs/data-model.md) |
| 02 | Auth, RBAC & security | Critical | [spec](prd-specs/02-auth-rbac-security.md) | [docs/security.md](docs/security.md) |
| 03 | Hospital onboarding & configuration | Important | [spec](prd-specs/03-hospital-onboarding-config.md) | — |
| 04 | Patient & discharge ingestion | Important | [spec](prd-specs/04-patient-discharge-ingestion.md) | — |
| 05 | Campaigns & eligibility | Important | [spec](prd-specs/05-campaigns-and-eligibility.md) | — |
| 06 | **Queue: priority & concurrency** | **Highest** | [spec](prd-specs/06-queue-scheduler-core.md) | [docs/queue-design.md](docs/queue-design.md) |
| 07 | **Queue: states, retries, callbacks, recovery** | **Highest** | [spec](prd-specs/07-queue-states-retries-callbacks.md) | [docs/queue-design.md](docs/queue-design.md) |
| 08 | **Queue simulation (mandatory)** | **Highest** | [spec](prd-specs/08-queue-simulation.md) | [docs/queue-design.md](docs/queue-design.md) |
| 09 | AI architecture, tools, providers | Critical | [spec](prd-specs/09-ai-architecture-and-tools.md) | [docs/ai-architecture.md](docs/ai-architecture.md) |
| 10 | Voice intake & call execution | Important | [spec](prd-specs/10-voice-intake-and-calls.md) | [docs/voice-intake.md](docs/voice-intake.md) |
| 10-OPT | Real telephony | Enhancement | [spec](prd-specs/10-OPT-real-telephony.md) | not built (out of scope, see doc 10 write-up) |
| 11 | Protocols & tenant-aware retrieval | Critical | [spec](prd-specs/11-retrieval-and-protocols.md) | [docs/protocols-and-retrieval.md](docs/protocols-and-retrieval.md) |
| 12 | Triage & structured outputs | Critical | [spec](prd-specs/12-triage-structured-outputs.md) | [docs/clinical-triage.md](docs/clinical-triage.md) |
| 13 | **Escalation consensus & safety** | **Highest** | [spec](prd-specs/13-escalation-consensus-safety.md) | [docs/escalation-consensus.md](docs/escalation-consensus.md) |
| 14 | Documentation & call records | Important | [spec](prd-specs/14-documentation-and-call-records.md) | [docs/documentation-and-mock-ehr.md](docs/documentation-and-mock-ehr.md) |
| 15 | Mock EHR & integration boundary | Important | [spec](prd-specs/15-mock-ehr.md) | [docs/documentation-and-mock-ehr.md](docs/documentation-and-mock-ehr.md) |
| 16 | Events, workflows & notifications | Important | [spec](prd-specs/16-events-workflows-notifications.md) | [docs/events-and-notifications.md](docs/events-and-notifications.md) |
| 17 | Escalation management & human loop | Important | [spec](prd-specs/17-escalation-management-human-loop.md) | [docs/escalation-management.md](docs/escalation-management.md) |
| 18 | Dashboards & analytics | Important | [spec](prd-specs/18-dashboards-analytics.md) | [docs/dashboards-and-analytics.md](docs/dashboards-and-analytics.md) |
| 19 | Observability, audit & health | Important | [spec](prd-specs/19-observability-audit-health.md) | [docs/observability-audit-health.md](docs/observability-audit-health.md) |
| 20 | Reliability, idempotency & recovery | Critical | [spec](prd-specs/20-reliability-idempotency-recovery.md) | [docs/reliability-idempotency-recovery.md](docs/reliability-idempotency-recovery.md) |
| 21 | **Safety evaluation & false-negative rate** | **Highest** | [spec](prd-specs/21-safety-evaluation-harness.md) | [docs/safety-evaluation.md](docs/safety-evaluation.md) |
| 22 | Testing strategy | Critical | [spec](prd-specs/22-testing.md) | [docs/testing.md](docs/testing.md) |
| 23 | Deployment & demo access | Required | [spec](prd-specs/23-deployment-and-demo.md) | [docs/deployment.md](docs/deployment.md) |
| 24 | Written deliverables & demo video | Required | [spec](prd-specs/24-written-deliverables.md) | this README + `docs/dev-ai-usage.md` |
| 25 | Optional features ranked by marks/hour | Enhancement | [spec](prd-specs/25-optional-standout-features.md) | not attempted — out of time budget |

## The three things that decide this submission
1. **The queue is provably correct under concurrency** — docs 06–08.
2. **Escalation uses genuinely independent assessors and defaults to escalating** — doc 13.
3. **You measured your own false-negative rate and reported it honestly** — doc 21.

Everything else is supporting evidence.
