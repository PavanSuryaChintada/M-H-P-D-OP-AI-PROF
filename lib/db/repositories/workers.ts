// Doc 19 R7 — worker heartbeats. A worker missing a heartbeat for more than
// STUCK_THRESHOLD_SECONDS counts as stuck for /api/health's queue block;
// doc 07's reaper is what actually recovers the lease that worker held.

import { eq, lt } from "drizzle-orm";
import { withTenant, withHospitalContext, type TenantContext } from "../tenant";
import { workers } from "../schema";

export const STUCK_THRESHOLD_SECONDS = 90;

export async function recordHeartbeat(ctx: TenantContext, workerId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(workers)
      .values({ hospitalId: ctx.hospitalId, workerId, lastHeartbeatAt: new Date() })
      .onConflictDoUpdate({
        target: [workers.hospitalId, workers.workerId],
        set: { lastHeartbeatAt: new Date() },
      })
      .returning();
    return row;
  });
}

export async function countStuckWorkers(hospitalId: string, thresholdSeconds: number = STUCK_THRESHOLD_SECONDS): Promise<number> {
  return withHospitalContext(hospitalId, async (tx) => {
    const cutoff = new Date(Date.now() - thresholdSeconds * 1000);
    const rows = await tx.select().from(workers).where(lt(workers.lastHeartbeatAt, cutoff));
    return rows.length;
  });
}

export async function listWorkers(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => tx.select().from(workers).where(eq(workers.hospitalId, ctx.hospitalId)));
}
