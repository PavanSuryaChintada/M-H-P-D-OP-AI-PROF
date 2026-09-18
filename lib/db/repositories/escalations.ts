// Doc 09/13/17 — escalations. Doc 09 only needs enough here to back the
// create_escalation tool (consensus-only per doc 13's hard rule); the
// guarded OPEN->ASSIGNED->...->CLOSED lifecycle and the reviewer UI are
// doc 17's scope.

import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { escalations, escalationStateTransitions } from "../schema";

export interface CreateEscalationInput {
  patientId: string;
  campaignId?: string;
  callId?: string;
  triggerReason: string;
  clinicalIndicators?: unknown;
  consensusResult?: unknown;
  priority: number;
}

/** The only writer of escalations.state should end up being doc 17's guarded transition function once it exists; this creates the initial OPEN row. */
export async function createEscalation(ctx: TenantContext, input: CreateEscalationInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(escalations)
      .values({ ...input, hospitalId: ctx.hospitalId, state: "OPEN" })
      .returning();
    await tx.insert(escalationStateTransitions).values({
      escalationId: row.id,
      hospitalId: ctx.hospitalId,
      fromState: null,
      toState: "OPEN",
      reason: input.triggerReason,
      actor: `system:${ctx.userId}`,
    });
    return row;
  });
}

export async function getEscalationById(ctx: TenantContext, escalationId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(escalations).where(eq(escalations.id, escalationId));
    return row ?? null;
  });
}

export async function listEscalationsForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) => tx.select().from(escalations).where(eq(escalations.patientId, patientId)));
}
