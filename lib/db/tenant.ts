import { sql } from "drizzle-orm";
import { db } from "./client";

export type Role =
  | "PLATFORM_ADMIN"
  | "HOSPITAL_ADMIN"
  | "CAMPAIGN_MANAGER"
  | "CLINICAL_REVIEWER";

export interface TenantContext {
  hospitalId: string;
  userId: string;
  role: Role;
}

// Extracted from db.transaction's own callback signature rather than named
// directly, so it always matches whatever drizzle-orm's postgres-js driver
// currently exports as its transaction type.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Opens a transaction, sets the per-transaction RLS GUCs from ctx, and runs
 * fn inside it. Every repository function goes through this — doc 01 R2.1.
 *
 * SET LOCAL cannot bind query parameters directly, so this uses
 * set_config(name, value, is_local), which postgres.js parameterizes safely
 * through the tagged `sql` template (no string interpolation into SQL text).
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.hospital_id', ${ctx.hospitalId}, true)`);
    await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
    await tx.execute(sql`select set_config('app.role', ${ctx.role}, true)`);
    return fn(tx);
  });
}

/**
 * Doc 06/07 worker processes act on behalf of a hospital, not a signed-in
 * user — there is no TenantContext to build. This arms RLS with just
 * app.hospital_id (the only GUC the queue tables' policies actually check;
 * see lib/db/rls.sql) so worker code reading/writing campaigns,
 * outreach_tasks, hospital_capacity etc. isn't silently filtered to zero
 * rows by the same RLS that protects everything else.
 */
export async function withHospitalContext<T>(hospitalId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.hospital_id', ${hospitalId}, true)`);
    return fn(tx);
  });
}
