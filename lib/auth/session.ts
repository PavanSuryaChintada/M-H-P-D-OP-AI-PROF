import { createSupabaseServerClient } from "../supabase/server";
import { findUserByAuthProviderId, getRolesForUser, type HospitalRole } from "../db/repositories/users";
import { writeAuditLog } from "../db/repositories/audit";
import type { TenantContext } from "../db/tenant";

export class UnauthenticatedError extends Error {
  constructor(message = "not authenticated") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

// Deliberately the same shape/message as "hospital doesn't exist" — doc 02
// R2 acceptance criteria: cross-tenant requests return 404, never 403, so a
// caller can't distinguish "not your hospital" from "no such hospital".
export class NoHospitalAccessError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NoHospitalAccessError";
  }
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
}

/** The signed-in app user, or null if there's no session / no matching app_user row yet. */
export async function getCurrentAppUser(): Promise<AppUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const appUser = await findUserByAuthProviderId(authUser.id);
  if (!appUser) return null;

  return {
    id: appUser.id,
    email: appUser.email,
    displayName: appUser.displayName,
    isPlatformAdmin: appUser.isPlatformAdmin,
  };
}

/** Every hospital + role the current user can open a tenant context for. */
export async function listAccessibleHospitals(): Promise<HospitalRole[]> {
  const appUser = await getCurrentAppUser();
  if (!appUser) throw new UnauthenticatedError();
  return getRolesForUser(appUser.id);
}

/**
 * Resolves the current session + a requested hospital into a TenantContext.
 * Throws NoHospitalAccessError (→ 404) if the user has no role at that
 * hospital — this is the standard path for HOSPITAL_ADMIN, CAMPAIGN_MANAGER
 * and CLINICAL_REVIEWER, and also covers a PLATFORM_ADMIN who additionally
 * holds an ordinary per-hospital role. It does NOT grant Platform Admin
 * access to hospitals they hold no role at — see resolvePlatformAdminAccess
 * for that separate, audited path (doc 02 R3).
 */
export async function resolveTenantContext(hospitalId: string): Promise<TenantContext> {
  const appUser = await getCurrentAppUser();
  if (!appUser) throw new UnauthenticatedError();

  const roles = await getRolesForUser(appUser.id);
  const match = roles.find((r) => r.hospitalId === hospitalId);
  if (!match) throw new NoHospitalAccessError();

  return { hospitalId, userId: appUser.id, role: match.role };
}

/**
 * The audited path for doc 02 R3: a Platform Admin reading an individual
 * hospital's patient/clinical data, without holding an ordinary role there.
 * Requires a non-empty reason and writes an audit_log entry before
 * returning the context — callers must not skip straight to withTenant()
 * with a hand-built PLATFORM_ADMIN context, or the audit trail is lost.
 */
export async function resolvePlatformAdminAccess(
  hospitalId: string,
  reason: string,
): Promise<TenantContext> {
  const appUser = await getCurrentAppUser();
  if (!appUser) throw new UnauthenticatedError();
  if (!appUser.isPlatformAdmin) throw new NoHospitalAccessError();
  if (!reason.trim()) {
    throw new Error("resolvePlatformAdminAccess requires a non-empty reason (doc 02 R3)");
  }

  const ctx: TenantContext = { hospitalId, userId: appUser.id, role: "PLATFORM_ADMIN" };
  await writeAuditLog(ctx, {
    action: "platform_admin.access_hospital_data",
    resourceType: "hospital",
    resourceId: hospitalId,
    reason,
  });
  return ctx;
}
