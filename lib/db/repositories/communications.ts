// Doc 09/14/15 — communications. Doc 09 needs enough here to back the
// record_communication tool (documentation agent) and the update_mock_ehr
// tool's write-back. The full FHIR Communication shaping and the mock
// EHR's failure-injection behavior are doc 14/15's scope.

import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { communications } from "../schema";

export interface CreateCommunicationInput {
  patientId: string;
  encounterId?: string;
  channel?: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  sentAt?: Date;
}

export async function createCommunication(ctx: TenantContext, input: CreateCommunicationInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(communications)
      .values({ ...input, hospitalId: ctx.hospitalId })
      .returning();
    return row;
  });
}

export async function listCommunicationsForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) =>
    tx.select().from(communications).where(eq(communications.patientId, patientId)),
  );
}
