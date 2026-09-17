import { eq, sql } from "drizzle-orm";
import { db } from "../client";
import { users, userHospitalRoles } from "../schema";
import type { Role } from "../tenant";

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

export async function createUser(input: { email: string; displayName: string; authProviderId?: string }) {
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
