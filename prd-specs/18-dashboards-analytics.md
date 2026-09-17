# 18 — Dashboards & Analytics

**PRD:** §22 · **Depends on:** 05, 06, 13, 17

---

## Scope
Four views. Operational, not decorative. PRD §34 warns explicitly that a pretty UI does not compensate for a weak queue — so build these fast and functional.

## Requirements

**R1 — Campaign Manager dashboard**
- Campaign progress bar: eligible / attempted / completed / escalated / manual / failed
- **Live capacity gauge** `active / max` — the single most important widget in the product
- Queue depth, oldest pending task age, tasks in each state
- **Patients approaching clinical cutoff** (Tier 1 count) — highlighted
- Retry backlog, callback schedule for the next 4 hours
- Controls: start, pause, resume, cancel, reprioritise
- Live queue table with tier, score, and a "why this order?" popover reading doc 06's score endpoint

**R2 — Hospital Admin dashboard**
- Campaigns overview, outreach volume, contact rate, average attempts to contact
- Escalation counts by priority and status, overdue count
- Manual follow-up backlog
- EHR sync health, protocol list and versions
- Staff activity: escalations resolved per reviewer, median time to resolve

**R3 — Platform Admin dashboard**
- Per-hospital activity, campaign volume, queue health, worker health
- AI usage: calls, tokens, estimated cost, p95 latency by agent, validation failure rate
- Error rates, dead-letter count, stuck task count
- **Aggregates only** — drilling into an individual patient writes an audit entry (doc 02)

**R4 — Patient operational view**
- Discharge info, outreach status, full attempt timeline, every call with outcome
- Observations, documentation, escalations, follow-up actions
- The timeline is the "what happened to this patient?" answer the PRD keeps asking for

**R5 — Campaign analytics:** eligible, attempted, completed, contact rate, average attempts, time-to-first-contact, queue wait time, retry rate, capacity utilisation, escalation rate, manual follow-up rate.

**R6 — Refresh:** 5s polling is sufficient and reliable. Only build SSE/websockets if everything else is done.

## Key deliverables
- [ ] Four dashboards per R1–R4
- [ ] Analytics query layer, tenant-scoped, indexed
- [ ] Capacity gauge component reused in the simulation page
- [ ] "Why this order?" score explainer popover
- [ ] Aggregate queries that cannot leak patient-level data across tenants
- [ ] Tests: analytics under Hospital A context never counts Hospital B rows

## Claude Code prompt
```
Implement the four dashboards per docs 05, 06, 13 and 17.

1. Campaign Manager dashboard with: progress counters (eligible/attempted/completed/
   escalated/manual/failed), a live capacity gauge showing active/max, queue depth, oldest
   pending age, per-state counts, a highlighted count of tasks within their cutoff window,
   retry backlog, the next 4 hours of scheduled callbacks, start/pause/resume/cancel/
   reprioritise controls, and a live queue table showing tier and priority score with a
   popover explaining the score breakdown from GET /api/tasks/:id/score.
2. Hospital Admin dashboard: campaigns overview, outreach volume, contact rate, average
   attempts, escalations by priority and status, overdue count, manual follow-up backlog,
   EHR sync health, protocol versions, and per-reviewer resolution stats.
3. Platform Admin dashboard: per-hospital activity, queue and worker health, AI usage
   (calls, tokens, cost, p95 latency by agent, validation failure rate), error rates,
   dead-letter count, stuck task count. Aggregates only; any patient-level drill-in writes
   an audit entry with a reason.
4. Patient operational view: discharge details, outreach status, a vertical timeline of every
   attempt with outcome, observations, documentation, escalations and follow-up actions.
5. Analytics query layer, all tenant-scoped, with the indexes needed to keep these fast.
6. Poll every 5 seconds. Do not build websockets.
7. Test that every analytics query under Hospital A context excludes Hospital B rows.
```
