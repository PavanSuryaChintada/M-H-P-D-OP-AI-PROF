# Security Posture — Doc 02 R7

## What is implemented

- **Authentication** — Supabase Auth session → `TenantContext { hospitalId, userId, role }` resolved on every request.
- **Authorization** — a single declarative permission matrix (`lib/auth/permissions.ts`), enforced by a route guard (`requireAllowed`) on every API handler. No scattered `if (role === ...)` checks.
- **Tenant isolation** — enforced in three independent layers: repository (`withTenant`), Postgres RLS (`lib/db/rls.sql`), and a static CI check (`tests/architecture.test.ts`). See `docs/data-model.md`.
- **No resource-existence leaks** — a cross-tenant request returns `404`, never `403`.
- **Platform Admin is not a clinical god-mode** — any Platform Admin read of an individual patient's clinical record writes an `audit_log` entry with a reason (`patient:view_clinical` grant is `"audited"`, not `true`, in the permission matrix).
- **Prompt-injection boundary** — patient utterances and retrieved documents are wrapped via `lib/ai/untrusted.ts` before entering any prompt, with a system-prompt fragment restating that delimited content is data, never instruction. Covered by an injection-resistance test (doc 21).
- **Secrets** — environment variables only. `.env.example` is committed with placeholders; `.env` is gitignored. CI checks for accidentally committed key-shaped strings (`sk-...`, `eyJ...`).
- **Log data minimisation** — `lib/obs/redact.ts` strips names, DOB, phone, email and address from any object before logging; patients are logged by id only.
- **Audit trail** — `audit_log` is append-only at the database level (privilege revocation + trigger), not just by convention.

## What is explicitly NOT claimed

This is a 3–4 day prototype. It is **not HIPAA certified, not SOC 2 certified, and not audited by a third party.** No claim of either is made anywhere in the product, the demo, or these docs.

## What production would require before handling real PHI

- A signed Business Associate Agreement (BAA) with every subprocessor (hosting, AI providers, telephony).
- Encryption at rest with customer-managed keys, not just the provider's default-at-rest encryption.
- Formal access reviews and least-privilege audits on a recurring schedule, not a one-time permission matrix.
- Audit log retention policy and tamper-evidence (e.g. write-once storage or hash chaining) beyond "UPDATE/DELETE revoked."
- PHI-safe logging verified by automated scanning in CI, not just the `redact()` allowlist implemented here.
- A documented breach-notification process.
- Data processing agreements (DPAs) with every vendor in the pipeline (AI providers, hosting, any real telephony/SMS provider).
- Penetration testing and a formal threat model beyond the informal one in this document.
- MFA enforcement and session-management hardening (idle timeout, device binding) beyond Supabase Auth defaults.
