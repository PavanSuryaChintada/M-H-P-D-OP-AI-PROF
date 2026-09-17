# 03 — Hospital Onboarding & Configuration

**PRD:** §4 · **Depends on:** 01, 02

---

## Scope
Creating a tenant and giving it the operating rules the queue and AI later read.

## Requirements

**R1 — Hospital record:** name, short code, contact, address, `timezone` (IANA), status (`CREATED → CONFIGURED → READY`).

**R2 — Operating configuration (drives the scheduler, so it must be real, not decorative):**
- `calling_hours`: per weekday `{start, end}` in hospital timezone
- `max_concurrent_calls` (integer, enforced in doc 06)
- `default_retry_policy`: `{max_attempts, backoff_minutes[], jitter_pct}`
- `default_follow_up_window_hours`
- `notification_preferences`: channels, reviewer timeout minutes, backup reviewer
- `ehr_settings`: mock endpoint, sync mode, failure injection rate (for demo)

**R3 — Escalation contacts:** ordered list with role, channel, and acknowledgement timeout.

**R4 — Protocols & knowledge** are uploaded here but specified in doc 11.

**R5 — Readiness gate:** a hospital cannot be marked `READY` unless it has ≥1 admin, ≥1 protocol, ≥1 escalation contact, calling hours, and capacity > 0. Show a checklist, not a silent failure.

**R6 — Timezone correctness:** store timestamps in UTC, evaluate calling windows in hospital-local time. Seed at least two hospitals in different timezones to prove it.

## Key deliverables
- [ ] Platform Admin hospital CRUD + config UI
- [ ] `hospital_config` validated with zod on write
- [ ] Readiness checklist endpoint + UI component
- [ ] Timezone helper `isWithinCallingHours(hospitalId, at)` with tests across DST
- [ ] Seeded demo hospitals: **at least 3**, different timezones, different capacity (e.g. 10, 3, 1) — the low-capacity one makes the queue demo vivid
- [ ] Audit entries for every config change

## Acceptance criteria
- Changing `max_concurrent_calls` takes effect on the next scheduler tick without restart.
- A hospital missing a protocol cannot be set READY, and the UI says exactly which item is missing.

## Claude Code prompt
```
Implement hospital onboarding and configuration per docs 01 and 02.

1. CRUD for hospitals, restricted to PLATFORM_ADMIN.
2. hospital_config jsonb validated by a zod schema covering: timezone, calling_hours per
   weekday, max_concurrent_calls, default_retry_policy {max_attempts, backoff_minutes[],
   jitter_pct}, default_follow_up_window_hours, notification_preferences {channels,
   reviewer_timeout_minutes, backup_reviewer_user_id}, ehr_settings {mode, failure_rate}.
3. escalation_contacts table: ordered, with channel and ack timeout.
4. Lifecycle CREATED -> CONFIGURED -> READY with a readiness checklist endpoint returning
   each unmet requirement by name.
5. isWithinCallingHours(hospitalId, atUtc) evaluating in the hospital's IANA timezone.
   Include tests spanning a DST transition.
6. Seed 3 hospitals: Northside General (America/New_York, capacity 10), Harbour Clinic
   (Europe/Stockholm, capacity 3), Rural Health Post (Asia/Kolkata, capacity 1).
7. Audit every configuration change with before/after.
```
