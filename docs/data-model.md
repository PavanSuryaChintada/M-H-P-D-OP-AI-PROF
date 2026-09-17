# Data Model — Doc 01

Source of truth is [`lib/db/schema.ts`](../lib/db/schema.ts). This is a navigation aid, not a column-complete spec — see the schema file for exact types, defaults and indexes.

## Tenant isolation (R1, R2)

Every table below except `hospitals` carries `hospital_id uuid NOT NULL REFERENCES hospitals(id)`. Isolation is enforced in three independent layers:

1. **Repository layer** — every repository function takes a `TenantContext { hospitalId, userId, role }` and runs inside [`withTenant()`](../lib/db/tenant.ts), which opens a transaction and sets `app.hospital_id` / `app.user_id` / `app.role` via `set_config(..., true)` (transaction-scoped, safely parameterized — not string-interpolated SQL).
2. **Postgres RLS** — [`lib/db/rls.sql`](../lib/db/rls.sql) adds a `tenant_isolation` policy to every tenant table, comparing `hospital_id` to `current_setting('app.hospital_id', true)`. This is defense-in-depth: even a repository bug that forgets a `WHERE hospital_id = ...` clause returns zero cross-tenant rows.
3. **Static check** — [`tests/architecture.test.ts`](../tests/architecture.test.ts) fails CI if `db.select/insert/update/delete(` appears anywhere outside `lib/db/repositories/`.

**RLS only works if the app connects as `app_user`, not Supabase's `postgres` superuser** — superusers bypass RLS unconditionally. See the header comment in `rls.sql`.

## Entity groups

### Tenancy & identity
```mermaid
erDiagram
    hospitals ||--o{ user_hospital_roles : "scopes"
    users ||--o{ user_hospital_roles : "holds"
    hospitals {
        uuid id PK
        text name
        text timezone
        text status
    }
    users {
        uuid id PK
        text email
        text auth_provider_id
    }
    user_hospital_roles {
        uuid id PK
        uuid user_id FK
        uuid hospital_id FK
        enum role "PLATFORM_ADMIN | HOSPITAL_ADMIN | CAMPAIGN_MANAGER | CLINICAL_REVIEWER"
    }
```

### FHIR-shaped clinical data (R3)
All of these carry `hospital_id`, `fhir_resource_type`, `source_payload jsonb`.

```mermaid
erDiagram
    patients ||--o{ encounters : has
    patients ||--o{ conditions : has
    patients ||--o{ observations : has
    patients ||--o{ medications : has
    patients ||--o{ care_plans : has
    patients ||--o{ procedures : has
    patients ||--o{ communications : has
    patients ||--o{ tasks : has
    encounters ||--o{ conditions : "recorded during"
    encounters ||--o{ observations : "recorded during"
```

### Protocols & retrieval (doc 11)
```mermaid
erDiagram
    hospitals ||--o{ protocols : owns
    protocols ||--o{ knowledge_chunks : "chunked into"
    knowledge_chunks {
        uuid id PK
        uuid hospital_id FK
        uuid protocol_id FK
        text content
        vector embedding "pgvector(1536)"
    }
```

### Campaigns & the outbound queue (docs 05–08)
```mermaid
erDiagram
    campaigns ||--o{ outreach_tasks : contains
    patients ||--o{ outreach_tasks : "targeted by"
    outreach_tasks ||--o{ outreach_task_state_transitions : logs
    outreach_tasks ||--o{ calls : produces
    hospitals ||--|| hospital_capacity : "caps concurrency for"
```

`outreach_tasks` carries the composite index `(hospital_id, state, scheduled_for)` and `(campaign_id, state)`, plus a partial index on active states (`PENDING, SCHEDULED, CALLING, RETRY_SCHEDULED, CALLBACK_SCHEDULED`) — these are what the scheduler's claim query (doc 06) hits. State changes are mirrored to `outreach_task_state_transitions` (R7) rather than overwritten in place.

### Calls, triage & escalation (docs 10, 12, 13)
```mermaid
erDiagram
    calls ||--o{ call_turns : contains
    calls ||--o| triage_results : produces
    calls ||--o| documentation_records : produces
    triage_results ||--o{ escalations : "may trigger"
    escalations ||--o{ escalation_state_transitions : logs
```

`escalations.consensus_result` holds the individual assessor outputs, the detected disagreement (if any), and the final decision — doc 13 defines the shape.

### Events, notifications, observability (docs 16, 19)
```mermaid
erDiagram
    hospitals ||--o{ events : emits
    hospitals ||--o{ notifications : sends
    hospitals ||--o{ audit_log : records
    hospitals ||--o{ ai_usage : records
```

`events.idempotency_key` is unique — consumers use it to detect and skip duplicate processing (doc 20). `audit_log` is append-only: `UPDATE`/`DELETE` are revoked from `app_user` and blocked again by a trigger, independently (R5).

## Deliberately deferred

- Full FHIR resource compliance — these tables are FHIR-*shaped* (R3), not conformant.
- RLS policy for Platform Admin cross-hospital aggregate reads — doc 18 builds this as explicit, audited aggregate queries, not an RLS bypass (doc 01 "Do not").
- Per-table repositories beyond `hospitals`, `users`, `patients` — added alongside the doc that first needs each aggregate (campaigns in doc 05, outreach_tasks in doc 06, etc.), following the same `TenantContext` + `withTenant()` pattern.
