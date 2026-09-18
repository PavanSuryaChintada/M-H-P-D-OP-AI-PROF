// Doc 09/16 — notifications. Doc 09 needs enough here to back the
// request_notification tool (escalation consensus only); actual delivery
// (email/webhook sending, retry, dead-letter) is doc 16's scope. This
// creates the PENDING row a doc 16 dispatcher will later pick up and send.

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
