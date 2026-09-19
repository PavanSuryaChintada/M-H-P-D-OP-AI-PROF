# Recovery runbook

Short and practical, per doc 20 R6. Five situations, what to check, what to do.

## 1. Stuck task (stuck in CALLING/CONNECTED)

**Symptom:** `/api/health` shows `stuck_workers > 0`, or a task sits in CALLING/CONNECTED past its `lease_expires_at`.

**Check:** `select * from outreach_tasks where state in ('CALLING','CONNECTED') and lease_expires_at < now();`

**Fix:** Call `reapExpiredLeases(hospitalId)` (`lib/db/repositories/outreach-tasks.ts`) — moves the task to `RETRY_SCHEDULED`, clears the claim, releases the held capacity slot. This runs automatically wherever the reaper is scheduled; if it isn't running, invoke it manually once, then check `hospital_capacity.current_active_calls` dropped back down.

## 2. Dead-letter event replay

**Symptom:** An event never processes; `/admin/hospitals/[hospitalId]` shows it in the dead-letter list (or query directly).

**Check:** `select * from events where hospital_id = '<id>' and status = 'DEAD';` — read `error` for why it kept failing.

**Fix:** Fix the underlying cause first (a bad payload, a bug in the handler). Then call `replayDeadEvent(hospitalId, eventId)` (`lib/db/repositories/events.ts`) — resets to `PENDING`, attempts to 0, claimable on the next poll. Don't replay blind; if the handler still throws, it'll just burn through `EVENT_MAX_ATTEMPTS` again.

## 3. EHR backlog (failed syncs piling up)

**Symptom:** `/admin/hospitals/[hospitalId]/dashboards/hospital-admin` shows a growing `ehrSyncHealth.failed` count.

**Check:** `select id, ehr_sync_error, ehr_sync_retry_count from documentation_records where ehr_sync_status = 'FAILED' order by created_at desc;`

**Fix:** If the mock EHR's configured `ehr_settings.failure_rate` was set too high (e.g. for a demo) and left that way, lower it via the hospital config. Otherwise call `retryFailedEhrSyncs(hospitalId, now)` (`lib/ehr/retry-worker.ts`) — replays with the original idempotency key, so a write that actually succeeded but lost its response (a timeout) will not double-write. Records that hit `EHR_MAX_RETRY_ATTEMPTS` stop auto-retrying but stay visible as `FAILED` — never silently dropped.

## 4. Worker not claiming

**Symptom:** Queue depth grows, `active_calls` stays below `max_concurrent_calls`, nothing moves.

**Check:**
- Is `hospital_capacity` row missing or `max_concurrent_calls = 0`? (`select * from hospital_capacity where hospital_id = '<id>';`) — a missing row makes every claim attempt silently find nothing to reserve.
- Are all pending tasks scheduled in the future? (`scheduled_for > now()`)
- Is the campaign actually `RUNNING`? A `PAUSED`/`DRAFT` campaign's tasks are correctly unclaimable.

**Fix:** Insert/correct the `hospital_capacity` row, or resume the campaign via `POST /api/hospitals/[hospitalId]/campaigns/[campaignId]/transition` with `{"to":"RUNNING"}`.

## 5. Capacity leak (active_calls never returns to 0)

**Symptom:** `current_active_calls` stays elevated even with no real calls running.

**Check:** Compare `current_active_calls` against `select count(*) from outreach_tasks where hospital_id = '<id>' and state in ('CALLING','CONNECTED');` — if the count is lower than the capacity number, something released the task without releasing capacity (or vice versa).

**Fix:** Run the reaper (situation 1) first — most leaks are just tasks stuck past their lease. If the numbers still don't match after that, the capacity counter itself is wrong; it can be corrected directly: `update hospital_capacity set current_active_calls = (select count(*) from outreach_tasks where hospital_id = '<id>' and state in ('CALLING','CONNECTED')) where hospital_id = '<id>';` — a manual, logged, one-time correction, not something to script into automatic recovery without understanding why it happened first.
