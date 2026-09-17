# Multi-Hospital Post-Discharge Outreach Platform

AI-powered patient follow-up, clinical triage, and hospital outreach operations platform.

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

| Doc | Title | Priority |
|---|---|---|
| 00 | Master brief, stack, build order | read first |
| 01 | Data model & multi-tenancy | Critical |
| 02 | Auth, RBAC & security | Critical |
| 03 | Hospital onboarding & configuration | Important |
| 04 | Patient & discharge ingestion | Important |
| 05 | Campaigns & eligibility | Important |
| 06 | **Queue: priority & concurrency** | **Highest** |
| 07 | **Queue: states, retries, callbacks, recovery** | **Highest** |
| 08 | **Queue simulation (mandatory)** | **Highest** |
| 09 | AI architecture, tools, providers | Critical |
| 10 | Voice intake & call execution | Important |
| 10-OPT | Real telephony | Enhancement |
| 11 | Protocols & tenant-aware retrieval | Critical |
| 12 | Triage & structured outputs | Critical |
| 13 | **Escalation consensus & safety** | **Highest** |
| 14 | Documentation & call records | Important |
| 15 | Mock EHR & integration boundary | Important |
| 16 | Events, workflows & notifications | Important |
| 17 | Escalation management & human loop | Important |
| 18 | Dashboards & analytics | Important |
| 19 | Observability, audit & health | Important |
| 20 | Reliability, idempotency & recovery | Critical |
| 21 | **Safety evaluation & false-negative rate** | **Highest** |
| 22 | Testing strategy | Critical |
| 23 | Deployment & demo access | Required |
| 24 | Written deliverables & demo video | Required |
| 25 | Optional features ranked by marks/hour | Enhancement |

## The three things that decide this submission
1. **The queue is provably correct under concurrency** — docs 06–08.
2. **Escalation uses genuinely independent assessors and defaults to escalating** — doc 13.
3. **You measured your own false-negative rate and reported it honestly** — doc 21.

Everything else is supporting evidence.
