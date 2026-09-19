# Hosting this for your demo — start to finish

One doc, top to bottom, for getting this live: the web app, the background
worker, and the database. Follow it in order. Total time if nothing goes
wrong: 20–30 minutes.

**The database is already done.** This whole project has been built and
tested against a real Supabase project all session — you are not creating
a new database for the demo. You're deploying two things *to* it: the web
app (Vercel) and the worker (Railway).

```
Browser ──▶ Vercel (Next.js web app + all /api/* routes)
                │
                ├──▶ Supabase (Postgres — already running, nothing to do)
                │
Railway ────────┘  (worker/index.ts — always-on, claims + runs the queue)
```

---

## 0. Before you start

You need:
- [ ] This repo pushed to GitHub (it already is)
- [ ] A **Vercel** account (free tier is fine) — vercel.com, sign in with GitHub
- [ ] A **Railway** account (free/hobby tier is fine) — railway.app, sign in with GitHub
- [ ] Your `.env` file open on your machine (it has the real Supabase credentials — copy values from here, never retype them by hand)

You do **not** need a new Supabase project, a domain name, or a credit card for the free tiers of Vercel/Railway (Railway's free trial credit is normally enough for a demo's worth of worker uptime — check their current pricing page if it's been more than a few weeks).

---

## 1. Deploy the web app (Vercel)

1. Go to vercel.com → **Add New → Project** → import this GitHub repo.
2. Framework preset: Vercel auto-detects **Next.js** — leave it as-is.
3. Build command / output: leave the defaults (`next build`).
4. **Environment Variables** — add every one of these (copy the values straight out of your local `.env`, do not retype):

   | Variable | Value comes from |
   |---|---|
   | `DATABASE_URL_POOLED` | your `.env` — this is the one the running app actually uses |
   | `SUPABASE_URL` | your `.env` |
   | `SUPABASE_ANON_KEY` | your `.env` |
   | `NEXT_PUBLIC_SUPABASE_URL` | same value as `SUPABASE_URL` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same value as `SUPABASE_ANON_KEY` |
   | `ANTHROPIC_API_KEY` | only if you have one — **leave blank for the demo**, see box below |
   | `OPENAI_API_KEY` | only if you have one — **leave blank for the demo** |

   **Do not set `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `WORKER_ID` on Vercel.** `DATABASE_URL` is the superuser/migration connection — the running web app never needs it, only your local machine does (for `db:migrate`). The service role key is only used by a local seed script. Setting either on the public web app is an unnecessary exposure.

   > **Why leave the AI keys blank on purpose:** with no key configured, the app automatically falls back to a deterministic mock AI (`MockProvider`) instead of calling a real, billed model — this is a real safety feature (`lib/ai/providers/select-provider.ts`), not a missing setup step. The whole demo (triage, consensus, escalation) works correctly on the mock. Only add real keys if you specifically want to show a live LLM call, and if you do, also set `AI_DAILY_BUDGET_USD` (e.g. `5`) so a demo mistake can't run up a bill.

5. Click **Deploy**. Wait for the build to finish (2–4 minutes).
6. Open the resulting URL (`https://your-project.vercel.app`). You should see the landing page, not an error.
7. Put that URL in `README.md`'s "Deployed URL" line so it's not lost.

---

## 2. Deploy the worker (Railway)

The worker is a separate, always-on process — it's what actually claims queued calls and runs them. Without it, the queue fills up but nothing ever gets called. **Do this before your demo, not during it.**

1. Go to railway.app → **New Project → Deploy from GitHub repo** → pick this repo.
2. Railway will try to guess a start command — override it:
   - **Start command:** `npm run worker`
   - **Build command:** leave default (`npm install` then Railway auto-detects; if it asks, build command is not needed since `npm run worker` runs via `tsx`, no separate build step)
3. **Variables** tab — add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL_POOLED` | same value as you put in Vercel |
   | `SUPABASE_URL` | same as Vercel |
   | `SUPABASE_ANON_KEY` | same as Vercel |
   | `WORKER_ID` | `railway-worker-1` (or anything distinct — it's just a label) |
   | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | same choice as you made in Vercel — leave blank unless you specifically want live AI |
   | `WORKER_TICK_INTERVAL_MS` | optional, defaults to `15000` (15s) — leave unset unless you want it faster/slower for the demo |

4. Deploy. Open the **Logs** tab and confirm you see:
   ```
   {"event":"worker.started", ...}
   ```
   within a few seconds. If a campaign is running with claimable tasks, you'll also see `worker.simulated_call` lines appear roughly once per tick interval.

**If nothing ever claims:** check that the hospital has a `hospital_capacity` row (see `docs/runbook.md` §4 — this was the single most common cause of "the queue looks stuck" while building this) and that the campaign's state is `RUNNING`, not `PAUSED`.

---

## 3. Verify before you trust it

Don't find out live during the demo. Check, in order:

1. Open `https://your-vercel-url/api/health` — should return JSON with `"status": "HEALTHY"`.
2. Open `https://your-vercel-url/login` — the four demo accounts should be listed with click-to-fill buttons.
3. Log in as `hospital-admin@demo.mhpd.local` / `Demo1234!`.
4. Open the hospital's **Escalation queue** page — it should load real data, not an error (if you see a 404 here, you're on a stale hospital ID from an old bookmark, not a real bug — go through `/admin/hospitals` instead of typing a URL from memory).
5. Watch the Railway worker logs for one full tick — you should see it touch the hospital (heartbeat) even if there's nothing to claim yet.
6. Run `npm run eval:safety` **locally** (not on the deployed app — it's a CLI harness) if you want to show the safety evaluation numbers; the report it produces is what `/admin/eval` on the deployed app reads.

---

## 4. Reset the demo data before you present

Run this from your own machine (it needs `DATABASE_URL`, the superuser connection — never put that on Vercel/Railway):

```bash
npm run demo:reset
```

This clears operational data (patients, calls, escalations, queue tasks) and reseeds a fresh batch of demo patients. It does **not** touch hospitals, users, or protocols — your demo login and hospital config survive a reset. It's a script, not a button in the app, on purpose: the app's own database connection deliberately has no delete permission (a real security boundary, not an oversight) — see `docs/known-limitations.md`.

Run it once, right before you present, so the queue/escalation numbers look fresh rather than like whatever state your last test run left behind.

---

## 5. Demo day checklist

- [ ] `npm run demo:reset` run within the last hour
- [ ] Vercel URL loads `/api/health` as `HEALTHY`
- [ ] Railway worker logs show a recent `worker.started`/heartbeat, not a crash loop
- [ ] Logged in as each of the four demo roles once, in a private/incognito window, to confirm nothing is cached from your dev session
- [ ] A campaign is set to `RUNNING` so the queue has visible movement during the demo, not a static empty table
- [ ] `docs/safety-evaluation.md` / `/admin/eval` open in a tab, ready to show the false-negative rate
- [ ] `docs/known-limitations.md` read once so you can answer "why doesn't it do X" with the actual documented reason instead of improvising

**Demo accounts** (all password `Demo1234!`):

| Role | Email |
|---|---|
| Platform Admin | `platform-admin@demo.mhpd.local` |
| Hospital Admin | `hospital-admin@demo.mhpd.local` |
| Campaign Manager | `campaign-manager@demo.mhpd.local` |
| Clinical Reviewer | `clinical-reviewer@demo.mhpd.local` |

---

## If something breaks during setup

- **Build fails on Vercel with a TypeScript/ESLint error** — it built and passed both locally before this doc was written; if it fails on Vercel specifically, check you didn't accidentally set `DATABASE_URL` (superuser) instead of `DATABASE_URL_POOLED` — the app connects with `app_user` at runtime and a superuser connection string in the wrong variable can behave differently under RLS.
- **Worker logs show nothing claiming** — see step 2's note above and `docs/runbook.md`.
- **502/500 from the web app right after deploy** — almost always a missing/misnamed environment variable. Recheck the table in step 1 against your actual Vercel project settings, not against memory.
- **Escalations or patients page 404s** — you're pointed at a hospital ID that doesn't belong to your logged-in account (often a stale bookmark from testing). Navigate from `/admin/hospitals` instead of a saved link.
- Anything else operational (stuck call, growing backlog, a worker that's gone quiet) — `docs/runbook.md` has five specific recovery scenarios with exact steps.

For the full architecture behind all of this — why the worker is a separate process, why Postgres and not Redis for the queue, the five module boundaries — see `docs/architecture.md`. For the deeper doc-23-specific reasoning (cost guard internals, why there's no live "reset" button) see `docs/deployment.md`.
