import { and, desc, eq, gte, lte } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { auditLog } from "../schema";

export interface AuditEntryInput {
  action: string;
  resourceType: string;
  resourceId?: string;
  reason?: string;
  metadata?: unknown;
}

export async function writeAuditLog(ctx: TenantContext, entry: AuditEntryInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(auditLog)
      .values({
        hospitalId: ctx.hospitalId,
        actorUserId: ctx.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        reason: entry.reason,
        metadata: entry.metadata,
      })
      .returning();
    return row;
  });
}

export interface AuditLogFilters {
  actorUserId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

/** Doc 19 R5 deliverable — "audit viewer with filters for actor, hospital, action type and date range." Hospital is always ctx.hospitalId (RLS), the rest are optional filters. */
export async function listAuditLog(ctx: TenantContext, filters: AuditLogFilters = {}, limit = 200) {
  return withTenant(ctx, async (tx) => {
    const conditions = [eq(auditLog.hospitalId, ctx.hospitalId)];
    if (filters.actorUserId) conditions.push(eq(auditLog.actorUserId, filters.actorUserId));
    if (filters.action) conditions.push(eq(auditLog.action, filters.action));
    if (filters.from) conditions.push(gte(auditLog.at, filters.from));
    if (filters.to) conditions.push(lte(auditLog.at, filters.to));

    return tx
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.at))
      .limit(limit);
  });
}
