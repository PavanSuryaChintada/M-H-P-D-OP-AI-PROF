// A shared actor identity for worker/system code that acts on behalf of a
// hospital rather than a signed-in user (doc 15's mock EHR, doc 16's event
// handlers). RLS on every table these touch only checks app.hospital_id
// (see rls.sql's tenant_isolation policy) — role is never checked — so this
// exists purely to satisfy TenantContext's shape.

import type { TenantContext } from "./tenant";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export function systemContext(hospitalId: string): TenantContext {
  return { hospitalId, userId: SYSTEM_USER_ID, role: "PLATFORM_ADMIN" };
}
