import { asc, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { escalationContacts } from "../schema";

export async function listEscalationContacts(ctx: TenantContext) {
  return withTenant(ctx, async (tx) =>
    tx
      .select()
      .from(escalationContacts)
      .where(eq(escalationContacts.hospitalId, ctx.hospitalId))
      .orderBy(asc(escalationContacts.orderIndex)),
  );
}

export interface AddEscalationContactInput {
  orderIndex: number;
  role: string;
  channel: "IN_APP" | "EMAIL" | "WEBHOOK";
  contactValue: string;
  ackTimeoutMinutes: number;
}

export async function addEscalationContact(ctx: TenantContext, input: AddEscalationContactInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(escalationContacts)
      .values({ ...input, hospitalId: ctx.hospitalId })
      .returning();
    return row;
  });
}

export async function countEscalationContacts(ctx: TenantContext): Promise<number> {
  const rows = await listEscalationContacts(ctx);
  return rows.length;
}
