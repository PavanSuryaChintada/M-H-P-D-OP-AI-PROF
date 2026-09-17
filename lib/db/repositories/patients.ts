import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { patients } from "../schema";

// Every function here is the reference pattern for R2.1: take TenantContext,
// run inside withTenant() so RLS is armed for the duration of the query, and
// never accept a raw hospitalId string in its place.

export interface CreatePatientInput {
  mrn: string;
  firstName: string;
  lastName: string;
  dob?: string;
  phone?: string;
  email?: string;
  preferredLanguage?: string;
  communicationPreferences?: unknown;
  sourcePayload?: unknown;
}

export async function createPatient(ctx: TenantContext, input: CreatePatientInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(patients)
      .values({ ...input, hospitalId: ctx.hospitalId })
      .returning();
    return row;
  });
}

export async function getPatientById(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(patients).where(eq(patients.id, patientId));
    return row ?? null;
  });
}

export async function listPatients(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => {
    // Deliberately unfiltered by hospital_id — the RLS policy set by
    // withTenant() is what must narrow this, not application code. This is
    // the exact shape the doc 01 acceptance-criteria test exercises.
    return tx.select().from(patients);
  });
}
