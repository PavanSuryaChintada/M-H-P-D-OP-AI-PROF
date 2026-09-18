# Development AI Usage Log — Deliverable 8

Logged as work happens, per doc 00 §7 ("cannot be reconstructed later"). One entry per session/task, newest first.

---

## 2026-09-18 — Doc 04: patient & discharge data ingestion

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Extended `encounters` with `risk_level` (new enum), `follow_up_window_hours`, and `source_message_id` (unique per hospital — the R5 idempotency key). Put these on the encounter rather than as a jsonb Observation value, since doc 05/06's eligibility and priority-scoring queries need to filter/sort on them directly.
- `lib/discharge/schema.ts` — the zod wire format for one discharge record. `lib/discharge/ingest.ts` — the shared pipeline (idempotency check by `sourceMessageId` → find-or-create patient by MRN → create encounter → create conditions/observations/medications/care plan → emit `patient.imported`/`discharge.ingested` events) used by both the HTTP batch endpoint and the generator directly, since seeding ~450 patients one HTTP round trip at a time defeats the point of a batch endpoint.
- `POST /api/hospitals/[id]/discharges` — accepts a JSON array or NDJSON body, validates every record independently with zod, returns `{accepted, rejected: [{index, field, reason}]}`. Partial success by design: one bad record never takes down the batch.
- **Found a real concurrency bug before it shipped**, not after: parallelizing the batch endpoint's per-record processing for throughput, I realized two records for the *same* MRN in one batch (a re-admission) would race the find-or-create-patient step if processed concurrently — both see "no patient yet," both try to create one, one hits the unique constraint. Fixed by grouping records by MRN first: different MRNs process concurrently (bounded to the pool size), same-MRN records process in order within their own group.
- `sim/rng.ts` (mulberry32, no dependency) + `sim/generate-patients.ts` — deterministic generator matching every distribution requirement in R2 (risk mix, discharge-time spread including near-deadline cases, follow-up window mix, ~8% invalid phone numbers, a handful of dual-condition "two campaign" candidates). Generation itself stays a single sequential loop (it's what consumes the shared RNG state — parallelizing it would break reproducibility), but the actual DB writes run with bounded concurrency, which is what actually matters for wall-clock time.
- **Deliberately did not fake two things doc 04's R2 asks for:** "~12% who will request callbacks" and "~15% who will present protocol red flags in conversation" are call-*behavior* scripting for a simulator that doesn't exist yet (doc 10) — there's no field to put them in yet, and it's doc 10's call to make whether that belongs on the patient or on a specific outreach task. Documented as an open gap rather than inventing a field now to satisfy the letter of R2.
- Closed a loop left open in doc 02: actually implemented the "audited" (Platform Admin, needs `?reason=`, routes through `resolvePlatformAdminAccess` and gets audit-logged) and "limited" (Campaign Manager sees demographics + risk/timing, not full clinical detail) grants on the new patient-detail route, rather than leaving them as permission-matrix entries nothing ever branched on.
- Minimal patient list + detail admin UI pages, linked from the hospital detail page.
- Sample feed: `sim/fixtures/sample-discharge-feed.ndjson`, 10 hand-written representative records (not generator output) showing the exact wire format.
- `npm run seed:demo` chains migrate → RLS → hospitals → users → patients into one command.
- Tests: idempotency (re-ingesting the same `sourceMessageId` doesn't duplicate), the literal acceptance criterion (3 malformed of N records → N-3 accepted, 3 rejected with field-level reasons), and same-batch-twice-same-row-count.

**Another real performance issue found via testing, not assumed:** the double-batch-of-10 test kept timing out even at 90s. Traced it to the batch endpoint's original strictly-sequential per-record loop — at confirmed multi-second-per-query latency on this network, 20 sequential ingests (each several round trips) genuinely doesn't fit in 90s. This is what led to parallelizing the endpoint (see the concurrency-bug entry above) — a real design improvement the test surfaced, not a workaround for the test itself. After the fix, the same test completes in well under its budget.

**Verified against the live project:** ran the generator at `--count 20` first to confirm the distribution logic (risk mix, hospital spread, invalid-phone rate) actually lands correctly in the DB, then ran the full `--count 450`. Took ~20 minutes wall-clock on this network (confirmed still making progress via `Get-Process`, not stalled — this is the same per-query latency documented in the doc 03 entry, not a new issue). Idempotency held across the two runs: the 20-patient test run's records showed up as "already ingested" in the full run rather than duplicating. Final dataset matches every R1/R2 target: 450 total patients, RHP (the low-capacity hospital) has 90, risk mix 49/35/11/5 (target 50/30/15/5), invalid phone rate 7.6% (target ~8%).

**Still open:** the two call-behavior scripting flags noted above (defer to doc 10); "eligible for two campaigns" is tagged via a second condition code on ~2% of patients, but there's no campaign/eligibility engine yet (doc 05) to actually confirm it produces dual eligibility — that's the next doc's job to close the loop on.

---

## 2026-09-17 (same day, later still still) — Doc 03: hospital onboarding & configuration

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Extended `hospitals` (short code, contact fields, address, a `hospital_status` enum CREATED→CONFIGURED→READY replacing doc 01's placeholder text status, and a `config jsonb` column) and added `escalation_contacts` — migrated live, including hand-editing the generated migration since existing rows (some permanently un-deletable by design — see doc 01/02 entries below) had the old `status='DRAFT'` value and no `short_code`; the blind enum cast and NOT NULL constraint drizzle-kit generated would have failed against real data, not just an empty table.
- Caught my own gap before applying RLS: added `escalation_contacts` to the schema but initially forgot to add it to `rls.sql`'s tenant-table list, which would have hit the exact Supabase auto-enables-RLS-with-no-policy trap documented in doc 01/02's entries again. Fixed before running anything against it.
- Built `lib/hospitals/timezone.ts` (`Intl.DateTimeFormat`-based local time conversion — no date library needed, Node's ICU already carries the IANA tz database), `calling-hours.ts` (`isWithinCallingHours`), `config-schema.ts` (zod-validated operating config), and `readiness.ts` (the R5 checklist, always returns the full missing-list, never a bare boolean).
- Repositories: extended `hospitals.ts`; added `escalation-contacts.ts`, `protocols.ts` (minimal — just enough for the readiness count, full protocol management is doc 11), `hospital-capacity.ts` (keeps `hospital_capacity.max_concurrent_calls` in sync with config, since that's what the doc 06/07 scheduler will actually read).
- 5 API routes (create/read hospital, PATCH config, escalation contacts CRUD, readiness, mark-ready) — all PLATFORM_ADMIN-gated per doc 03's own prompt ("CRUD for hospitals, restricted to PLATFORM_ADMIN"). Added `hospital:configure` to the permission matrix rather than overloading `hospital:create` for a PATCH.
- A minimal but functional admin UI (`/login`, `/admin/hospitals`, `/admin/hospitals/[id]`) — plain fetch + useState, no component library (none is in the stack). The config editor is a raw-JSON textarea pre-filled with a valid template rather than ~15 individual form fields for every nested config key; a prototype-scoped simplification, not a stub — the zod schema is still what actually validates it server-side.
- Tests: `calling-hours.test.ts` (includes a real DST spring-forward and fall-back transition test — caught my own arithmetic error in the test itself before trusting it: I had the offset direction backwards in one assertion), `hospital-config.test.ts` (schema edge cases), `readiness.test.ts` (live DB, walks the checklist from empty to everything-but-a-protocol).
- Seed scripts: `seed-demo-hospitals.ts` — the exact 3 from doc 03's prompt (Northside General/America/New_York/10, Harbour Clinic/Europe/Stockholm/3, Rural Health Post/Asia/Kolkata/1). Deliberately left at CONFIGURED, not READY — faking a protocol row just to flip a status flag would misrepresent what's actually built; doc 11 doesn't exist yet, so "missing a protocol" is the honest, correct readiness result for all three right now.

**A real debugging detour worth recording:** the test suite intermittently hung for 30-60s+ on `beforeAll` hooks after these changes. Chased it through: (1) suspected connection-pool exhaustion from parallel test files → disabled `fileParallelism`, didn't fully fix it; (2) wrote throwaway diagnostic scripts using `tsx -e "<inline code>"` that themselves hung on trivial code with no DB involved at all — that was tooling noise, `tsx -e` appears broken in this environment independent of anything in this project; (3) once diagnosed properly with an actual `.ts` file, confirmed the real cause: this network has several seconds of round-trip latency to the Supabase pooler (a raw `select 1` took 3.5-8.4s across repeated tries) — not a hang, just slow, and the original 10s default timeout wasn't enough for a `beforeAll` doing several sequential writes. Fixed by raising Vitest's timeouts to real-network-appropriate values and parallelizing independent setup calls in `rbac.test.ts` with `Promise.all`. Separately, found and fixed two actual test bugs the slower runs surfaced: hardcoded `shortCode` values collided with permanently-undeletable leftover rows from earlier runs (needed a per-run unique suffix, same pattern `readiness.test.ts` already used correctly), and two `afterAll` hooks would crash on `undefined.id` if their own `beforeAll` had failed first, masking the real error.

**Still open:** doc 03's config UI is a JSON textarea, not per-field controls (see above) — a reasonable prototype simplification, not a gap I'd call hidden. Protocol upload (doc 11) is what's actually blocking these hospitals from reaching READY.

---

## 2026-09-17 (same day, later still) — Doc 02 finished: Supabase Auth, route guard, demo users, RBAC + injection tests

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Found and fixed a real gap in doc 01's schema: `PLATFORM_ADMIN` is hospital-independent (manages all hospitals), but the schema only stored roles per-hospital via `user_hospital_roles`. Added `users.is_platform_admin boolean`, migrated it live.
- Built the Supabase Auth wiring: `lib/supabase/{server,client,admin}.ts` (SSR/browser/admin clients), `lib/auth/session.ts` (`getCurrentAppUser`, `resolveTenantContext` — cross-tenant → `NoHospitalAccessError`/404, and `resolvePlatformAdminAccess` — the audited PA-reads-one-hospital's-data path from doc 02 R3, which writes to `audit_log` via a proper repository call, not a direct query), and `lib/auth/guard.ts` (`guard()` for hospital-scoped actions, `guardPlatformAdmin()` for global ones like `hospital:create`; maps to 401/403/404 per the doc's own acceptance criteria — cross-tenant is 404, never 403, so existence doesn't leak).
- Added `middleware.ts` — the standard Supabase SSR session-refresh pattern; without it, Server Components can't write cookies themselves and sessions would silently go stale.
- Wired 3 demonstration API routes (`POST /api/hospitals`, `GET /api/hospitals/[id]`, `POST .../escalations/[id]`) — enough to exercise the guard chain end-to-end, not full business logic (that's docs 03/17).
- Added `hospital:read` to the permission matrix — not in the PRD §3 table verbatim; flagging it as necessary plumbing (every resolved role needs to read its own hospital's metadata) rather than a silent scope addition.
- **Caught my own mistake before it shipped:** almost called `tx.insert(auditLog)` directly inside `lib/auth/session.ts` for the PA audit-write, which would have violated doc 01 R2.3 (all queries through `lib/db/repositories/`) — the static check didn't catch it because it only matched `db.*`, not `tx.*`. Fixed by adding `lib/db/repositories/audit.ts` and *also* tightening `tests/architecture.test.ts`'s regex to catch `tx.*` too, closing the loophole for future code, not just this one call site.
- Wrote `tests/rbac.test.ts` (mocks only the Supabase Auth boundary — `getCurrentAppUser`, `resolveTenantContext`, the permission matrix, and the DB all run for real against live seeded fixtures) and `tests/prompt-injection.test.ts`, scoped honestly: verifies `wrapUntrusted()`'s delimiting and that `UNTRUSTED_CONTENT_NOTICE` names the classic attack, but does NOT claim to test "triage output is unaffected" — no triage agent exists yet (doc 12/13), so that claim would be fabricated. Documented the real limitation: a forged closing delimiter embedded in patient text does produce a second, earlier-looking close marker in the raw string; the system-prompt notice is what has to carry the actual defense, not delimiter unforgeability.
- **Found and fixed a genuine Postgres RLS bug** via the RBAC tests: `current_setting('app.hospital_id', true)` returns `''` (empty string), not `NULL`, once that custom GUC has been `SET LOCAL`-scoped at least once on a connection and then reverted — so a transaction that deliberately leaves it unset (like `getRolesForUser`, by design, since it runs before a hospital context exists) hit `invalid input syntax for type uuid: ''` on every RLS-protected table. Fixed by adding `app_hospital_id()`/`app_user_id()` SQL helper functions to `rls.sql` that `nullif(...,'')` before casting, used everywhere instead of the raw expression.
- Wrote `scripts/seed-demo-users.ts` — creates one demo hospital + 4 pre-confirmed demo accounts (Admin API, so no email-confirmation wait). Ran it against the live project once the service role key was provided; verified all 4 users, the `is_platform_admin` flag, and the 3 hospital-scoped role rows landed correctly.
- Full suite: 20/20 tests passing against the live database (`tests/architecture.test.ts`, `tests/tenancy.test.ts`, `tests/rbac.test.ts`, `tests/prompt-injection.test.ts`). `tsc --noEmit` and `eslint` clean.

**Doc 02 is fully done, including the seeded demo accounts.** Demo credentials (password `Demo1234!` for all four): `platform-admin@demo.mhpd.local`, `hospital-admin@demo.mhpd.local`, `campaign-manager@demo.mhpd.local`, `clinical-reviewer@demo.mhpd.local` — all under "Demo General Hospital" except the platform admin, who isn't hospital-scoped.

**Operational security note (again):** the user also pasted the project's publishable key, new-style secret key, and legacy anon/service_role JWTs directly into chat. Only the new-style secret key was used (`SUPABASE_SERVICE_ROLE_KEY`); the legacy JWTs weren't stored anywhere, reducing what's sitting in `.env`. Same recommendation as before applies to this key too: rotate it from the dashboard once convenient, since it's now in plaintext chat history.

**Still open:** a real login page (deferred — doc 02's own deliverable list doesn't ask for one, only session resolution + seeded accounts).

---

## 2026-09-17 — Scaffold + doc 01 (data model & tenancy) + doc 02 partial (RBAC pieces)

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Scaffolded Next.js 15.5.25 App Router + TypeScript (create-next-app defaulted to Next 16; pinned back to 15 per doc 00's stack decision and re-ran install).
- Built the repo layout from doc 00 §6 (`/lib/db`, `/lib/queue`, `/lib/ai`, `/lib/ehr`, `/lib/events`, `/lib/obs`, `/lib/auth`, `/worker`, `/sim`, `/eval`, `/docs`, `/tests`).
- Wrote the full Drizzle schema (`lib/db/schema.ts`) — 29 tables covering tenancy, FHIR-shaped clinical resources, protocols/pgvector, campaigns/queue, calls/triage/escalation, events/notifications, and observability, per doc 01 R1–R7.
- Wrote `lib/db/tenant.ts` (`TenantContext` + `withTenant()` using `set_config(..., true)` — parameterized, not string-interpolated) and `lib/db/rls.sql` (RLS policy per tenant table, `app_user` role, audit_log append-only via revoke + trigger).
- Wrote reference repositories (`hospitals`, `users`, `patients`) establishing the pattern for later docs to extend.
- Wrote `tests/tenancy.test.ts` (integration — needs a live DB) and `tests/architecture.test.ts` (static, doc 01 R2.3 — no `db.*` calls outside `lib/db/repositories/`); the static test passes.
- Ran `drizzle-kit generate`; confirmed all 29 tables, the partial/composite indexes on `outreach_tasks`, and the `vector(1536)` column generated correctly; manually added `CREATE EXTENSION IF NOT EXISTS vector;` to the migration (drizzle-kit doesn't emit extension statements).
- Drafted doc 02's dependency-free pieces: `lib/auth/permissions.ts` (declarative role/action matrix), `lib/ai/untrusted.ts` (prompt-injection delimiting), `lib/obs/redact.ts` (PHI log scrubbing), `docs/security.md` (honest compliance statement).
- Fixed scaffold/tooling mismatches from the Next 16→15 downgrade: `app/layout.tsx` used a Next-16-only `LayoutProps` global type; `eslint.config.mjs` imported `eslint-config-next` paths that only exist in the Next 16 package and assumed flat-config exports the Next 15 package doesn't provide — rewrote it using `FlatCompat` per the standard Next 15 pattern.
- Full `tsc --noEmit` passes clean across the codebase.

**Deliberate scope decisions (see `docs/data-model.md` "Deliberately deferred"):**
- Repositories for tables not yet needed (campaigns, outreach_tasks, calls, etc.) are left for the doc that first needs them (05, 06, 10, ...), following the same `TenantContext`/`withTenant()` pattern already established.
- Platform Admin cross-hospital aggregate reads are explicitly NOT implemented as an RLS bypass — deferred to doc 18's audited aggregate-query design, per doc 01's "Do not."

**Still open before doc 02 can be marked done:**
- Doc 02's Next.js-specific pieces (Supabase Auth wiring, the `requirePermission` route guard, seeded demo users, the allow/deny test matrix, the injection-resistance test) — not yet written.

---

## 2026-09-17 (same day, later) — Wired to the live Supabase project, doc 01 verified end-to-end

**Tool:** Claude Code (Sonnet 5).

**What was done:**
- Connected to the user's Supabase project and ran migrations + `rls.sql` against it for real.
- Hit and fixed two environment issues neither of us could have known about from the spec alone:
  1. New Supabase projects only expose the direct `db.[ref].supabase.co` host over IPv6; this network has no IPv6 route. Fixed by switching to Supabase's Supavisor pooler (session mode, port 5432, for migrations; transaction mode, port 6543, for the app) and disabling `postgres.js` prepared statements (`prepare: false`), which transaction-mode pooling doesn't support.
  2. Supabase auto-enables RLS by default on every new table in `public`. This silently turned `hospitals` and `users` — tables that intentionally have no RLS policy, since they sit above the tenant boundary — into an accidental deny-all. Fixed by explicitly `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` on those two in `rls.sql`, with a comment explaining why.
- Wrote `scripts/apply-rls.ts` — reads `lib/db/rls.sql`, substitutes the real `app_user` password (from `DATABASE_URL_POOLED` in `.env`) only in memory, and executes it. The committed `rls.sql` keeps its `CHANGE_ME` placeholder; the real password is never written to a tracked file.
- Ran `tests/tenancy.test.ts` against the live database. All 6 assertions passed: repository-level isolation, raw-SQL-under-RLS with a deliberately unfiltered query, cross-tenant lookup-by-id blocked, and both the delete-blocked and update-blocked audit_log immutability tests.
- Fixed the test's own cleanup logic along the way: `app_user` has no `DELETE` grant (correct, tight privilege model), so cleanup needs an admin connection; and `hospitalA` becomes permanently non-deletable once an `audit_log` row references it (the FK + append-only trigger working exactly as designed) — the test now deletes what it can and documents why the rest is intentionally left.

**Operational security note:** the user pasted a live DB password and a Supabase personal access token directly into chat. Both now exist in plaintext conversation history. Recommended (to the user, not yet done): rotate the Postgres password and the `sbp_...` access token from the Supabase dashboard once initial setup is confirmed working. The Supabase CLI token was never actually used — our stack connects directly via `DATABASE_URL`/Drizzle, not the Supabase CLI — which limits, but doesn't eliminate, its exposure.

**Doc 01 is now fully done and verified, not just written.** Doc 02 remains partial — see above.
