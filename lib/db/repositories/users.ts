import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { users, userHospitalRoles } from "../schema";
import { withTenant, type Role, type TenantContext } from "../tenant";

// users/user_hospital_roles sit at the auth bootstrap boundary: we need to
// look up which hospitals a user belongs to *before* a hospital context
// exists. lib/db/rls.sql's self_read policy on user_hospital_roles allows
// this by user_id; these functions set app.user_id (but not app.hospital_id)
// for that lookup, then doc 02's auth layer picks a hospital and opens a
// normal withTenant() context for everything after.

export async function findUserByAuthProviderId(authProviderId: string) {
  const [row] = await db.select().from(users).where(eq(users.authProviderId, authProviderId));
  return row ?? null;
}

export async function findUserByEmail(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row ?? null;
}

export async function createUser(input: {
  email: string;
  displayName: string;
  authProviderId?: string;
  isPlatformAdmin?: boolean;
}) {
  const [row] = await db.insert(users).values(input).returning();
  return row;
}

export interface HospitalRole {
  hospitalId: string;
  role: Role;
}

/** Every hospital + role a user holds — used to populate the tenant switcher. */
export async function getRolesForUser(userId: string): Promise<HospitalRole[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const rows = await tx
      .select({ hospitalId: userHospitalRoles.hospitalId, role: userHospitalRoles.role })
      .from(userHospitalRoles)
      .where(eq(userHospitalRoles.userId, userId));
    return rows;
  });
}

/**
 * Grants userId a role at hospitalId. Only used from privileged, non-request
 * paths (seed scripts; doc 03's hospital-admin-bootstrap flow) — there is no
 * route handler exposing this directly, since a normal caller assigning a
 * role should already hold hospital:manage_users at that hospital, checked
 * by the route guard before this is ever reached.
 */
export async function assignHospitalRole(input: { userId: string; hospitalId: string; role: Role }) {
  return withTenant({ hospitalId: input.hospitalId, userId: input.userId, role: input.role }, async (tx) => {
    const [row] = await tx.insert(userHospitalRoles).values(input).returning();
    return row;
  });
}

/** Doc 03 R5 readiness gate — "≥1 admin". ctx is typically a PLATFORM_ADMIN context opened for this specific hospitalId (see resolvePlatformAdminAccess-style construction), not a membership row of its own. */
export async function countHospitalAdmins(ctx: TenantContext): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({ id: userHospitalRoles.id })
      .from(userHospitalRoles)
      .where(
        and(eq(userHospitalRoles.hospitalId, ctx.hospitalId), eq(userHospitalRoles.role, "HOSPITAL_ADMIN")),
      );
    return rows.length;
  });
}
