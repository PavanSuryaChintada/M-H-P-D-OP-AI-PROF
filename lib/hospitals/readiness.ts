// Doc 03 R5 — a hospital cannot be marked READY unless it has ≥1 admin,
// ≥1 protocol, ≥1 escalation contact, calling hours, and capacity > 0.
// "Show a checklist, not a silent failure" — computeReadiness always
// returns the full list of what's missing, never just a boolean.

import { getHospitalById } from "../db/repositories/hospitals";
import { countHospitalAdmins } from "../db/repositories/users";
import { countProtocols } from "../db/repositories/protocols";
import { countEscalationContacts } from "../db/repositories/escalation-contacts";
import { HospitalConfigSchema, type HospitalConfig } from "./config-schema";
import type { TenantContext } from "../db/tenant";

export interface ReadinessResult {
  ready: boolean;
  missing: string[];
}

/** actingUserId is a Platform Admin's user id — readiness is PA-gated, same as the rest of doc 03's CRUD (see app/api/hospitals routes). */
export async function computeReadiness(actingUserId: string, hospitalId: string): Promise<ReadinessResult> {
  const hospital = await getHospitalById(hospitalId);
  if (!hospital) throw new Error("hospital not found");

  const ctx: TenantContext = { hospitalId, userId: actingUserId, role: "PLATFORM_ADMIN" };
  const missing: string[] = [];

  let config: HospitalConfig | null = null;
  if (hospital.config) {
    const parsed = HospitalConfigSchema.safeParse(hospital.config);
    if (parsed.success) config = parsed.data;
  }

  if (!config) {
    missing.push("operating configuration");
  } else {
    const hasCallingHours = Object.values(config.callingHours).some(Boolean);
    if (!hasCallingHours) missing.push("calling hours (at least one day configured)");
    if (!(config.maxConcurrentCalls > 0)) missing.push("capacity (max_concurrent_calls must be > 0)");
  }

  const [adminCount, protocolCount, contactCount] = await Promise.all([
    countHospitalAdmins(ctx),
    countProtocols(ctx),
    countEscalationContacts(ctx),
  ]);

  if (adminCount < 1) missing.push("at least one hospital admin");
  if (protocolCount < 1) missing.push("at least one protocol");
  if (contactCount < 1) missing.push("at least one escalation contact");

  return { ready: missing.length === 0, missing };
}
