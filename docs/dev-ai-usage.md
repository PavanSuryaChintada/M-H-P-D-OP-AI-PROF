# Development AI Usage Log — Deliverable 8

Logged as work happens, per doc 00 §7 ("cannot be reconstructed later"). One entry per session/task, newest first.

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
- Wrote `scripts/seed-demo-users.ts` — creates one demo hospital + 4 pre-confirmed demo accounts (Admin API, so no email-confirmation wait). **Not yet run against the live project — needs `SUPABASE_SERVICE_ROLE_KEY`, which hasn't been provided.**
- Full suite: 20/20 tests passing against the live database (`tests/architecture.test.ts`, `tests/tenancy.test.ts`, `tests/rbac.test.ts`, `tests/prompt-injection.test.ts`). `tsc --noEmit` and `eslint` clean.

**Still open:** run `seed-demo-users.ts` once the service role key is available; a real login page (deferred — doc 02's own deliverable list doesn't ask for one, only session resolution + seeded accounts).

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
