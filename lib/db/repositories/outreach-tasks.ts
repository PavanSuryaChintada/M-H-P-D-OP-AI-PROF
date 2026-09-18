import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { outreachTasks } from "../schema";

// Minimal — doc 05's eligibility engine needs to know a patient's existing
// tasks across campaigns (the "not already completed" / "not in a
// conflicting campaign" rules). Task creation, claiming, and the rest of
// the queue is doc 06/07's scope.
export async function listOutreachTasksForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) => tx.select().from(outreachTasks).where(eq(outreachTasks.patientId, patientId)));
}
