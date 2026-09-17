# 01 — Data Model & Multi-Tenancy

**PRD:** §3, §5, §26 · **Depends on:** 00 · **Blocks:** everything

---

## Scope
The healthcare data model and the tenant isolation mechanism. This is the foundation — get it wrong and every later doc inherits the bug.

## Requirements

**R1 — Tenant column everywhere.** Every table holding patient-related data has `hospital_id uuid NOT NULL REFERENCES hospitals(id)`. No exceptions, including `calls`, `escalations`, `audit_log`, `ai_usage`, `knowledge_chunks`.

**R2 — Three layers of isolation.**
1. Repository layer: every read/write takes an explicit `TenantContext { hospitalId, userId, role }`. No repository function accepts a raw query without it.
2. Postgres RLS: policies on every tenant table using `current_setting('app.hospital_id')`, set per-transaction.
3. A lint/test that fails CI if any `db.select()` is called outside a repository.

**R3 — Healthcare-shaped resources, not flat JSON.** Implement FHIR-*shaped* tables (not full compliance): `patients`, `encounters`, `conditions`, `observations`, `medications`, `care_plans`, `procedures`, `organizations`, `communications`, `tasks`. Each keeps a `fhir_resource_type` and a `source_payload jsonb`.

**R4 — Operational tables.** `hospitals`, `users`, `user_hospital_roles`, `protocols`, `knowledge_chunks`, `campaigns`, `outreach_tasks`, `calls`, `call_turns`, `triage_results`, `escalations`, `documentation_records`, `events`, `notifications`, `audit_log`, `ai_usage`, `hospital_capacity`.

**R5 — Auditability.** `audit_log` is append-only: `REVOKE UPDATE, DELETE` from the app role. Insert-only trigger-protected.

**R6 — Indexing for the queue.** Composite index on `outreach_tasks (hospital_id, state, scheduled_for)` and `(campaign_id, state)`. Partial index on active states.

**R7 — History.** Task and escalation state changes write to a `*_state_transitions` table with `from_state`, `to_state`, `reason`, `actor`, `at`.

## Key deliverables
- [ ] `lib/db/schema.ts` — full Drizzle schema
- [ ] Migration files, runnable from clean
- [ ] `lib/db/rls.sql` — RLS policies for every tenant table
- [ ] `lib/db/tenant.ts` — `TenantContext` + `withTenant()` transaction wrapper that sets the RLS GUC
- [ ] `lib/db/repositories/*.ts` — one per aggregate, all tenant-scoped
- [ ] ER diagram (`docs/data-model.md`) — one diagram, Mermaid
- [ ] Test: Hospital A context cannot read Hospital B rows, at repository level AND via raw SQL with RLS on

## Acceptance criteria
- A test that sets `app.hospital_id` to A and selects all patients returns zero B rows even with a deliberately unfiltered query.
- Deleting from `audit_log` as the app role raises a permission error.

## Claude Code prompt
```
Build the data model and tenancy layer per the standing context block.

1. Drizzle schema for: hospitals, users, user_hospital_roles, patients, encounters,
   conditions, observations, medications, care_plans, procedures, communications, tasks,
   protocols, knowledge_chunks (with pgvector embedding), campaigns, outreach_tasks, calls,
   call_turns, triage_results, escalations, documentation_records, events, notifications,
   audit_log, ai_usage, hospital_capacity, outreach_task_state_transitions,
   escalation_state_transitions.
2. Every patient-related table gets hospital_id uuid NOT NULL with an FK and an index.
3. FHIR-shaped clinical tables keep fhir_resource_type and source_payload jsonb.
4. Write RLS policies for every tenant table keyed on current_setting('app.hospital_id').
5. Write lib/db/tenant.ts exposing withTenant(ctx, fn) which opens a transaction, SETs the
   GUC, and runs fn. All repositories must go through it.
6. Make audit_log append-only at the database level.
7. Add the composite indexes listed for outreach_tasks.
8. Write tests proving cross-tenant reads return nothing, both through repositories and
   through a deliberately unfiltered raw query under RLS.

Do not build any API routes or UI in this task.
```

## Do not
- Do not filter by hospital in React. Ever.
- Do not add a `superadmin bypasses RLS` path. Platform Admin gets aggregate views through explicit, audited aggregate queries (doc 18).
