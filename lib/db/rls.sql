-- lib/db/rls.sql — doc 01 R2.2 (Postgres RLS) and R5 (audit_log append-only).
--
-- Run this once against the Supabase database AFTER migrations have created
-- the tables:
--   psql "$DATABASE_URL" -f lib/db/rls.sql
-- (or paste into the Supabase SQL editor). It must run as a role that can
-- create roles and alter table security — Supabase's default "postgres".
--
-- IMPORTANT — read before assuming RLS is protecting anything:
-- Postgres row-level security is never applied to superusers or to roles
-- with BYPASSRLS, no matter how many policies exist or whether
-- FORCE ROW LEVEL SECURITY is set. Supabase's "postgres" role is a
-- superuser. The app and worker must connect as app_user (created below),
-- NOT as "postgres" — set DATABASE_URL_POOLED in .env to app_user's
-- connection string after running this script.
--
-- This file is committed, so the CHANGE_ME placeholder below is
-- intentional — never replace it with a real password in this file. Set the
-- real password out-of-band (e.g. `ALTER ROLE app_user PASSWORD '...'`
-- run once, matching whatever DATABASE_URL_POOLED already has in .env).

-- ---------------------------------------------------------------------------
-- 1. Application role
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user login password 'CHANGE_ME' nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

grant usage on schema public to app_user;
grant select, insert, update on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;

-- ---------------------------------------------------------------------------
-- 1a. GUC accessor helpers — every policy below uses these instead of a raw
--     current_setting(...)::uuid. Reason: once a custom GUC like
--     app.hospital_id has been SET LOCAL at least once on a given backend
--     connection, current_setting(name, true) returns '' (empty string) —
--     not NULL — once that LOCAL scope ends (e.g. after COMMIT), because
--     Postgres creates a placeholder for the name on first use. A bare
--     ''::uuid cast then throws "invalid input syntax for type uuid",
--     which surfaces as a hard failure the first time any transaction
--     deliberately leaves app.hospital_id unset on a connection that
--     previously had it set (found via tests/rbac.test.ts, where
--     getRolesForUser() intentionally sets only app.user_id). nullif(...,'')
--     turns that '' back into a real NULL before the cast.
-- ---------------------------------------------------------------------------
create or replace function app_hospital_id() returns uuid as $$
  select nullif(current_setting('app.hospital_id', true), '')::uuid;
$$ language sql stable;

create or replace function app_user_id() returns uuid as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$ language sql stable;

-- ---------------------------------------------------------------------------
-- 1b. hospitals and users — Supabase auto-enables RLS on every new table in
--     `public` by default (a security-by-default measure), which leaves
--     these two with RLS on and zero policies: an accidental deny-all, not
--     a deliberate one. Neither table carries hospital_id (hospitals IS the
--     tenant; users sits above it and is looked up before a hospital
--     context exists — see users.ts and user_hospital_roles below), so
--     there is no row to filter by tenant here. Their access control is
--     RBAC at the application layer (lib/auth/permissions.ts), not RLS —
--     turn RLS back off rather than leave a policy-less deny-all in place.
-- ---------------------------------------------------------------------------
alter table hospitals disable row level security;
alter table users disable row level security;

-- ---------------------------------------------------------------------------
-- 2. Tenant isolation — every table in TENANT_TABLE_NAMES (lib/db/schema.ts)
--    except user_hospital_roles, which needs a different policy shape (see
--    below) because auth must be able to look up a user's roles before a
--    hospital context exists to set app.hospital_id to.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tenant_tables text[] := array[
    'organizations','patients','encounters','conditions','observations',
    'medications','care_plans','procedures','communications','tasks',
    'protocols','knowledge_chunks','campaigns','outreach_tasks',
    'outreach_task_state_transitions','calls','call_turns','triage_results',
    'escalations','escalation_state_transitions','documentation_records',
    'events','notifications','audit_log','ai_usage','hospital_capacity',
    'escalation_contacts','campaign_state_transitions','eligibility_evaluations'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      $p$create policy tenant_isolation on %I
         using (hospital_id = app_hospital_id())
         with check (hospital_id = app_hospital_id())$p$,
      t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. user_hospital_roles — bootstrap policy.
--    A user must be able to read their own role rows to discover which
--    hospitals they may open a tenant context for, before app.hospital_id
--    is set. Writes (assigning a role) are scoped to the active hospital
--    context like any other tenant table.
-- ---------------------------------------------------------------------------
alter table user_hospital_roles enable row level security;
alter table user_hospital_roles force row level security;

drop policy if exists self_read on user_hospital_roles;
create policy self_read on user_hospital_roles
  for select
  using (user_id = app_user_id() or hospital_id = app_hospital_id());

drop policy if exists tenant_write on user_hospital_roles;
create policy tenant_write on user_hospital_roles
  for insert
  with check (hospital_id = app_hospital_id());

drop policy if exists tenant_update on user_hospital_roles;
create policy tenant_update on user_hospital_roles
  for update
  using (hospital_id = app_hospital_id())
  with check (hospital_id = app_hospital_id());

-- Hospital + first Hospital Admin bootstrap (doc 03) needs a path that runs
-- before any user_hospital_roles row exists for that hospital. That path
-- must use SUPABASE_SERVICE_ROLE_KEY through a narrow, audited server
-- action — never by granting app_user a general bypass.

-- ---------------------------------------------------------------------------
-- 4. audit_log — append-only (R5). Belt-and-suspenders: privilege revocation
--    AND a trigger, so this holds even against a future role that ends up
--    with UPDATE/DELETE granted some other way.
-- ---------------------------------------------------------------------------
revoke update, delete on audit_log from app_user;

create or replace function audit_log_immutable() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update on audit_log
  for each row execute function audit_log_immutable();

drop trigger if exists audit_log_no_delete on audit_log;
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function audit_log_immutable();
