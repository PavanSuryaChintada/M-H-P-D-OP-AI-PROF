import { eq } from "drizzle-orm";
import { withTenant, withHospitalContext, type TenantContext } from "../tenant";
import { hospitalCapacity } from "../schema";

export async function getHospitalCapacity(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(hospitalCapacity).where(eq(hospitalCapacity.hospitalId, ctx.hospitalId));
    return row ?? null;
  });
}

/** Doc 06 scheduler — worker processes have no TenantContext, only the hospital they're ticking for. */
export async function getHospitalCapacityByHospitalId(hospitalId: string) {
  return withHospitalContext(hospitalId, async (tx) => {
    const [row] = await tx.select().from(hospitalCapacity).where(eq(hospitalCapacity.hospitalId, hospitalId));
    return row ?? null;
  });
}

// doc 06/07 own the live currentActiveCalls tracking; doc 03 only needs to
// keep maxConcurrentCalls in sync with hospital_config whenever it changes,
// so the scheduler picks up a capacity change on its next tick without a
// restart (doc 03 acceptance criteria).
export async function upsertHospitalCapacity(ctx: TenantContext, maxConcurrentCalls: number) {
  return withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select()
      .from(hospitalCapacity)
      .where(eq(hospitalCapacity.hospitalId, ctx.hospitalId));

    if (existing) {
      const [row] = await tx
        .update(hospitalCapacity)
        .set({ maxConcurrentCalls, updatedAt: new Date() })
        .where(eq(hospitalCapacity.hospitalId, ctx.hospitalId))
        .returning();
      return row;
    }

    const [row] = await tx
      .insert(hospitalCapacity)
      .values({ hospitalId: ctx.hospitalId, maxConcurrentCalls })
      .returning();
    return row;
  });
}
