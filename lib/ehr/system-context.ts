// Doc 15 R2 — the mock EHR is a separate route namespace standing in for an
// external system, authenticated per-hospital (a real EHR integration
// carries its own service credentials, not a signed-in user's role). RLS on
// every table it touches only checks app.hospital_id (see rls.sql's
// tenant_isolation policy), so this synthetic actor identity exists purely
// to satisfy TenantContext's shape — role is never checked by these writes.

import type { TenantContext } from "../db/tenant";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export function ehrSystemContext(hospitalId: string): TenantContext {
  return { hospitalId, userId: SYSTEM_USER_ID, role: "PLATFORM_ADMIN" };
}
