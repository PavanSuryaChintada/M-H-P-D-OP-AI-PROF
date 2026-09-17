import { NextResponse } from "next/server";
import { requireAllowed, ForbiddenError, type Action } from "./permissions";
import {
  resolveTenantContext,
  getCurrentAppUser,
  UnauthenticatedError,
  NoHospitalAccessError,
  type AppUser,
} from "./session";
import type { TenantContext } from "../db/tenant";

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
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (err instanceof NoHospitalAccessError) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }

  try {
    requireAllowed(ctx.role, action);
  } catch (err) {
    if (err instanceof ForbiddenError) {
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
