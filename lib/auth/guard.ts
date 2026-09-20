import { NextResponse } from "next/server";
import { can, requireAllowed, ForbiddenError, type Action } from "./permissions";
import {
  resolveTenantContext,
  getCurrentAppUser,
  UnauthenticatedError,
  NoHospitalAccessError,
  type AppUser,
} from "./session";
import type { TenantContext } from "../db/tenant";
import { log } from "../obs/logger";

/**
 * Route-handler guard: resolves the session for `hospitalId`, checks `action`
 * against the permission matrix, and returns either a TenantContext to
 * proceed with or a Response to return immediately. Doc 02 acceptance
 * criteria: unauthenticated → 401, wrong role → 403, no access to the
 * hospital (including a hospital that doesn't exist) → 404, never 403 —
 * existence of a resource you can't reach must not leak.
 *
 * Usage in a route handler:
 *   const gate = await guard(hospitalId, "campaign:manage");
 *   if (gate instanceof Response) return gate;
 *   const ctx = gate; // TenantContext, permission already checked
 */
export async function guard(hospitalId: string, action: Action): Promise<TenantContext | Response> {
  let ctx: TenantContext;
  try {
    ctx = await resolveTenantContext(hospitalId);
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      log("warn", "auth.denied", { action, hospitalId, reason: "unauthenticated" });
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (err instanceof NoHospitalAccessError) {
      // A Platform Admin holds no ORDINARY per-hospital role, so
      // resolveTenantContext() rejects them here before the permission
      // matrix is ever consulted - even for actions the matrix already
      // grants them outright (hospital:read, hospital:configure,
      // hospital:manage_users - onboarding/admin metadata, not clinical
      // content). That's a real gap, not a security feature: a Platform
      // Admin literally could not open a hospital's own Overview page.
      // Only a plain `true` grant gets this fallback - "audited" grants
      // like patient:view_clinical still require the separate, reasoned
      // resolvePlatformAdminAccess() path (doc 02 R3), never this one.
      const appUser = await getCurrentAppUser();
      if (appUser?.isPlatformAdmin && can("PLATFORM_ADMIN", action) === true) {
        return { hospitalId, userId: appUser.id, role: "PLATFORM_ADMIN" };
      }
      log("warn", "auth.denied", { action, hospitalId, reason: "no_hospital_access" });
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }

  try {
    requireAllowed(ctx.role, action);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      log("warn", "auth.denied", { action, hospitalId, role: ctx.role, reason: "forbidden" });
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw err;
  }

  return ctx;
}

/**
 * Guard for actions that aren't scoped to any hospital at all (e.g.
 * "hospital:create" — there's no existing hospital to resolve a
 * TenantContext against). Checks the session's global isPlatformAdmin flag
 * directly rather than going through resolveTenantContext.
 */
export async function guardPlatformAdmin(action: Action): Promise<AppUser | Response> {
  const appUser = await getCurrentAppUser();
  if (!appUser) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!appUser.isPlatformAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    requireAllowed("PLATFORM_ADMIN", action);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw err;
  }

  return appUser;
}
