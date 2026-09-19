// Doc 09/16 — notifications. Doc 09 needs enough here to back the
// request_notification tool (escalation consensus only); actual delivery
// (send + status + retry visibility) is doc 16's scope. Dead-letter and the
// in-app notification centre UI are deferred to doc 17/18's frontend work.

import { and, eq, like } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { notifications } from "../schema";

export interface CreateNotificationInput {
  recipientUserId?: string;
  channel: "IN_APP" | "EMAIL" | "WEBHOOK";
  subject?: string;
  body: string;
  relatedEscalationId?: string;
}

export async function createNotification(ctx: TenantContext, input: CreateNotificationInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(notifications)
      .values({ ...input, hospitalId: ctx.hospitalId, status: "PENDING" })
      .returning();
    return row;
  });
}

/**
 * Doc 16 R7 — "in-app always works; email/SMS optional and allowed to fail
 * visibly." This build has no real email/webhook provider, so those
 * channels are marked FAILED with an explicit, honest error rather than
 * faking a send — a silently-invented delivery would be worse than a
 * visible one that never happened.
 */
export async function deliverNotification(ctx: TenantContext, notificationId: string) {
  return withTenant(ctx, async (tx) => {
    const [existing] = await tx.select().from(notifications).where(eq(notifications.id, notificationId));
    if (!existing) return null;

    const isDeliverable = existing.channel === "IN_APP";
    const [row] = await tx
      .update(notifications)
      .set({
        status: isDeliverable ? "SENT" : "FAILED",
        sentAt: isDeliverable ? new Date() : undefined,
        error: isDeliverable ? null : `${existing.channel} delivery is not implemented in this build`,
        attempts: existing.attempts + 1,
      })
      .where(eq(notifications.id, notificationId))
      .returning();
    return row;
  });
}

/**
 * Doc 16 R3 idempotency guard for the escalation notification chain — a
 * `subjectPrefix` tag (e.g. "escalation:<id>:primary") identifies "have we
 * already notified for this stage," so re-running a handler for a
 * duplicate-delivered event is a no-op instead of a second notification.
 */
export async function hasNotificationTagged(ctx: TenantContext, relatedEscalationId: string, subjectPrefix: string) {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.relatedEscalationId, relatedEscalationId), like(notifications.subject, `${subjectPrefix}%`)))
      .limit(1);
    return rows.length > 0;
  });
}

export async function listNotificationsForEscalation(ctx: TenantContext, escalationId: string) {
  return withTenant(ctx, async (tx) =>
    tx.select().from(notifications).where(eq(notifications.relatedEscalationId, escalationId)),
  );
}
