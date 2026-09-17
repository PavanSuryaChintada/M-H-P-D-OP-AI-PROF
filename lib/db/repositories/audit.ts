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
