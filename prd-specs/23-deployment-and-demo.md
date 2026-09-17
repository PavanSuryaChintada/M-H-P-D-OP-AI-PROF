# 23 — Deployment & Demo Access

**PRD:** §30, §33 · **Depends on:** all

---

## Scope
A publicly reachable prototype the evaluator can log into without contacting you.

## Requirements

**R1 — Topology**
- Web (Next.js) → Vercel
- Worker (scheduler, reaper, event dispatcher, EHR retry) → Railway, always-on
- Postgres + pgvector → Supabase
- Mock EHR → routes inside the Next.js app

**R2 — The worker is the risk.** Vercel cannot run a long-lived process. Deploy the worker to Railway on day 1 and verify it claims a task in production before you build anything on top of it. Discovering this on day 4 is fatal.

**R3 — Demo credentials** for all four roles, in the README and on the login page:
```
platform@demo.test    / DemoPass123!   Platform Admin
admin@northside.test  / DemoPass123!   Hospital Admin
manager@northside.test/ DemoPass123!   Campaign Manager
nurse@northside.test  / DemoPass123!   Clinical Reviewer
```
Seed data is public and synthetic. State that plainly.

**R4 — One-click demo reset.** A Platform Admin button that re-seeds to a known state. The evaluator will break something; let them recover without emailing you.

**R5 — Environment** via `.env.example` documenting every variable with a comment. No secrets committed. CI grep check.

**R6 — README must contain:** what it is, architecture diagram, local setup in ≤5 commands, `seed:demo`, `npm run sim`, `npm run eval:safety`, deployed URL, credentials, deliverable index linking to every doc, known limitations link.

**R7 — Cost guard.** Cap AI spend: token limits per call, a daily budget in `ai_usage`, and the simulation using `MockProvider` by default so a grader cannot accidentally run up your bill.

## Key deliverables
- [ ] Deployed web + worker + DB, publicly reachable
- [ ] Worker verified claiming tasks in production
- [ ] Demo credentials, all four roles
- [ ] Demo reset button
- [ ] `.env.example` fully documented
- [ ] README per R6
- [ ] Budget guard

## Acceptance criteria
- From a private browser window, a stranger can open the URL, log in as each role, start a campaign, and watch the queue move — with no help.

## Claude Code prompt
```
Prepare deployment and demo access.

1. Configure the Next.js app for Vercel and a separate worker entrypoint for Railway running
   the scheduler tick, reaper, event dispatcher and EHR retry worker. Shared code, separate
   process. Verify in production that the worker claims a task.
2. Seed four demo users, one per role, with the credentials in this spec, and surface them
   on the login page.
3. A Platform Admin 'Reset demo data' action that truncates operational tables and re-runs
   seed:demo transactionally.
4. .env.example documenting every variable with a comment. Add a CI step that fails if a
   pattern matching an API key is committed.
5. README with: overview, architecture diagram, 5-command local setup, seed/sim/eval
   commands, deployed URL, demo credentials, an index linking every document in /docs, and
   a link to known limitations.
6. Cost guard: max tokens per AI call, a daily spend ceiling computed from ai_usage that
   switches to MockProvider when exceeded, and MockProvider as the simulation default.
```
