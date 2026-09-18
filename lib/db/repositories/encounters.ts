import { and, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { encounters } from "../schema";

export interface CreateEncounterInput {
  patientId: string;
  careSetting?: string;
  admissionAt?: Date;
  dischargeAt: Date;
  dischargeInstructions?: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  followUpWindowHours?: number;
  sourceMessageId?: string;
}

export async function createEncounter(ctx: TenantContext, input: CreateEncounterInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(encounters)
      .values({ ...input, hospitalId: ctx.hospitalId })
      .returning();
    return row;
  });
}

/** Doc 04 R5 idempotency check — a discharge with this sourceMessageId has already been ingested for this hospital. */
export async function findEncounterBySourceMessageId(ctx: TenantContext, sourceMessageId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(encounters)
      .where(and(eq(encounters.hospitalId, ctx.hospitalId), eq(encounters.sourceMessageId, sourceMessageId)));
    return row ?? null;
  });
}

export async function listEncountersForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) =>
    tx.select().from(encounters).where(eq(encounters.patientId, patientId)),
  );
}
