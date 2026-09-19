// Doc 15 — the FHIR "Task" resource the mock EHR's createTask writes to.
// Distinct from outreach_tasks (the call queue) — see schema.ts's own note
// on that table.

import { withTenant, type TenantContext } from "../tenant";
import { tasks } from "../schema";

export interface CreateTaskInput {
  patientId: string;
  encounterId?: string;
  description: string;
  status?: string;
  dueAt?: Date;
}

export async function createTask(ctx: TenantContext, input: CreateTaskInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(tasks).values({ ...input, hospitalId: ctx.hospitalId }).returning();
    return row;
  });
}
