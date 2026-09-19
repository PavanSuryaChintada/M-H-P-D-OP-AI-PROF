# Deployment & Demo Access (Doc 23)

## What's built vs. what needs your own accounts

Everything in this doc that's *code* is done: the worker entrypoint, demo credentials, the reset script, the CI secret scan, the cost guard. Actually deploying to Vercel/Railway requires accounts, billing, and OAuth authorization that only you can grant — no CLI in this environment is authenticated to either service, and creating cloud resources or spending real money isn't something to do without you present. This doc is the exact, minimal steps to finish it yourself.

## Topology (R1)

```
Browser → Vercel (Next.js: pages + all /api/* routes, including the mock EHR)
              │
              ├──▶ Supabase (Postgres + pgvector + RLS) — already set up and used all session
              │
              └──▶ Railway (worker/index.ts, always-on) — also talks to Supabase directly
```

## Steps

1. **Supabase** — already done. The project this whole build has been running against is the production database; nothing changes here for deployment.

2. **Vercel (web)**
   - Import this GitHub repo at vercel.com.
   - Framework preset: Next.js (auto-detected).
   - Environment variables: everything in `.env.example` **except** `WORKER_ID` and `WORKER_TICK_INTERVAL_MS` (worker-only). Use `DATABASE_URL_POOLED` as `DATABASE_URL` isn't needed at runtime by the web app — only migrations need the superuser connection, and those run locally/CI, not on Vercel.
   - Deploy. Note the resulting URL and put it in this README's "Deployed URL" line at the top.

3. **Railway (worker) — R2 says this is the risk, do it first, not last**
   - New Railway project → deploy from the same GitHub repo.
   - Start command: `npm run worker` (runs `worker/index.ts`).
   - Environment variables: `DATABASE_URL_POOLED`, `WORKER_ID=railway-worker-1`, and the same Supabase/AI variables as Vercel (the worker's simulated calls go through the same `lib/voice-intake/run-call.ts` pipeline as everything else — see `worker/index.ts`'s own comment on why it simulates the call itself: no real telephony exists in this build).
   - **Verify immediately**: check Railway's logs for a `worker.started` line, then a `call.started`/`call.outcome` pair within one tick interval (15s default) once a campaign is `RUNNING` with claimable tasks. If nothing claims within a few minutes, check `hospital_capacity` has a row for the hospital (a missing row is the #1 cause found while building this — see `docs/runbook.md` §4).

4. **Demo credentials (R3)** — already seeded (`npm run seed:demo-users`), already shown on `/login` itself, not just this README.

5. **Demo reset (R4)** — `npm run demo:reset`, run from wherever has `DATABASE_URL` (your local machine or a Railway/CI shell — not a live button in the app; see `app/page.tsx`'s own note on why: the app's runtime DB connection deliberately has no delete permission, and that's not worth weakening for a self-service button).

## Environment variables (R5)

Every variable is documented with a comment in `.env.example`. `.env` itself is gitignored (never committed). CI (`.github/workflows/ci.yml`) has a "Secret scan" step that greps every tracked file for API-key-shaped patterns (Anthropic, OpenAI, AWS, Supabase JWTs) and fails the build if one is found — catching the case where a real key gets pasted into a script or doc by accident, not just a committed `.env`.

## Cost guard (R7)

Three independent layers, in `lib/ai/providers/select-provider.ts`:
1. Every real provider call already caps `max_tokens` (default 1024, doc 09).
2. No `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` configured → always `MockProvider`. A grader who doesn't set these literally cannot spend anything.
3. A daily spend ceiling per hospital (`AI_DAILY_BUDGET_USD`, default $5), computed from real recorded `ai_usage` rows — once exceeded, that hospital falls back to `MockProvider` for the rest of the day.

**Honest note**: this selector has no caller yet. Every actual call path in this build (`lib/voice-intake/run-call.ts`'s emergency triage, the worker's simulated calls, every test) deliberately uses `MockProvider` directly — a scope decision made in doc 10/13 (proving escalation logic doesn't depend on live LLM agreement) that was never revisited to wire in a real provider call anywhere. `MockProvider` as the simulation default (R7's last bullet) is therefore already true by construction, not by this guard actively intercepting a real spend path — the guard is ready infrastructure for whenever a real provider call is wired in, not something currently gating live traffic.

## What this build does not cover

- Actually running the Vercel/Railway deployment (requires your accounts — see above).
- A live "reset" button in the UI (deliberately a script instead — see R4 above).
- Wiring `selectProvider` into an actual call path (nothing in this build currently calls a live AI provider at all).
