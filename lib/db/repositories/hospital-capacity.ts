import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { hospitalCapacity } from "../schema";

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
