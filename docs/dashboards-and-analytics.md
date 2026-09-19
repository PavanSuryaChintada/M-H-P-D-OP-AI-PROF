# Dashboards & Analytics (Doc 18)

## Platform Admin aggregates never bypass RLS

Doc 01's own rule, restated in doc 13's comments: "Platform Admin cross-hospital aggregate reads are explicitly NOT implemented as an RLS bypass." Every tenant table's RLS policy FORCEs row security and checks `app.hospital_id` — there is no query shape that reads across hospitals through the `app_user` role without it. `lib/analytics/platform-admin.ts` aggregates by looping per hospital under `withHospitalContext` (the same one-hospital-at-a-time GUC scoping every worker in this codebase already uses) and summing in application code — never a single unscoped cross-hospital SQL query. This also mechanically enforces R3's "aggregates only": nothing in this code path can select a patient-level row from a hospital the caller didn't explicitly scope into, because the RLS boundary is still live at every single query.

**Known scaling limit, deliberately not solved here**: this means the Platform Admin dashboard issues one DB round trip per hospital per widget. Fine for a demo with a handful of hospitals; a real deployment with hundreds would need a periodically-refreshed cross-hospital reporting table instead. Out of scope for a 6-day build.

**p95 latency across hospitals is approximated, not exact.** `getPlatformAiUsage` combines each hospital's own `percentile_cont(0.95)` result via `max()` across hospitals rather than recomputing a true p95 over the pooled raw samples (which would require pulling every raw latency value out of RLS-scoped queries and merging them outside the database). Documented as an approximation in the code — it's conservative (never understates the tail) rather than falsely precise.

## Reused rather than rebuilt

- The "why this order?" popover (R1) reuses doc 06's existing `/api/hospitals/[hospitalId]/tasks/[taskId]/score` endpoint verbatim — it already returns the full score breakdown; the dashboard just fetches and renders it.
- Campaign controls (start/pause/resume/cancel) call doc 05's existing `/api/hospitals/[hospitalId]/campaigns/[campaignId]/transition` endpoint. **"Reprioritise" is not implemented** — no reprioritisation concept exists anywhere else in this build (campaign priority is set at creation, not adjusted live), and inventing one now would be new scope, not wiring up doc 18 to something that already exists.

## Median, not average, for reviewer resolution time

R2 asks for "median time to resolve" specifically — `getReviewerStats` uses `percentile_cont(0.5) within group (...)`, not `avg()`. A median is what was asked for and is far less skewed by one long-running escalation than a mean would be.

## Patient timeline merges four sources

R4's timeline (`lib/analytics/patient-timeline.ts`) merges `calls`, `escalations`, `documentation_records`, and `tasks` (the FHIR Task follow-up table from doc 15) into one chronologically-sorted feed — the "what happened to this patient?" answer, in one request.

## Tenant isolation is structural, not just tested

Every Campaign Manager/Hospital Admin analytics function goes through `withTenant`, which is the same RLS-backed mechanism every repository in this codebase already uses — there's no separate "analytics is different" code path that could accidentally forget a `WHERE hospital_id = ...` clause. The required test (`tests/analytics-tenant-isolation.test.ts`) seeds Hospital B with deliberately *more and different* data than Hospital A (more tasks, a different backlog state, more escalations, higher active-call count) specifically so a missing filter would immediately inflate Hospital A's numbers rather than coincidentally match.

**Two real bugs found while writing that test, not the code it tests**: (1) a patient MRN collision — the fixture reused loop index `i` as part of the MRN across two separate seeding calls for the same hospital, tripping the real `patients_hospital_mrn_idx` unique constraint; fixed by keying MRNs off a per-call label. (2) `createHospital` does not auto-create a `hospital_capacity` row, so the fixture's `UPDATE hospital_capacity SET ...` silently matched zero rows instead of erroring — exactly the kind of silent-no-op this test exists to catch, just in its own setup rather than the code under test. Fixed by `INSERT`ing the row instead.

## Frontend: four pages, 5-second polling, no websockets (R6)

- `/admin/hospitals/[hospitalId]/dashboards/campaign-manager` — capacity gauge, queue depth, cutoff-approaching count, retry backlog, callback schedule, campaign progress with controls, live queue table with the score popover.
- `/admin/hospitals/[hospitalId]/dashboards/hospital-admin` — overview, escalation counts with overdue highlighted, manual follow-up backlog, EHR sync health, protocol versions, reviewer stats.
- `/admin/platform/dashboard` — per-hospital activity, AI usage by agent, error/dead-letter/stuck-task counts. Not hospital-scoped in its URL, gated by `guardPlatformAdmin`.
- `/admin/hospitals/[hospitalId]/patients/[patientId]/timeline` — the R4 patient operational view.

All four poll every 5 seconds via `setInterval`, per R6's explicit instruction not to build SSE/websockets. Same minimal inline-style convention as every other page in this build — "build these fast and functional," per the spec's own words, not decorative.

## What this build does not cover

- A shared, reusable capacity-gauge *component* — the gauge is inlined in the Campaign Manager dashboard rather than extracted and reused in `/simulation` (the deliverables list asks for reuse there); both pages show the same numbers today, just via separately-written markup.
- Campaign "reprioritise" control (see above — no such concept exists elsewhere yet).
- Interactive browser testing — verified via `npx tsc --noEmit`, `npx next build`, and the same repository-level integration tests the API routes call, consistent with doc 17's note (no browser tool in this environment).
- A dedicated audit entry for Platform Admin drilling into a specific patient (R3) — this build's Platform Admin dashboard never surfaces a patient-level drill-in at all, so there's nothing yet that would need one.
