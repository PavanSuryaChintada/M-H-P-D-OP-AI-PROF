// Doc 04 R3 — the remaining FHIR-shaped resources a discharge record
// produces (conditions, observations, medications, a care plan). Grouped
// in one file since each is a thin create+list pair over a single table;
// split out if any of them grows real business logic later.

import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { conditions, observations, medications, carePlans } from "../schema";

export interface CreateConditionInput {
  patientId: string;
  encounterId?: string;
  codeText: string;
  clinicalStatus?: string;
}
export async function createCondition(ctx: TenantContext, input: CreateConditionInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(conditions).values({ ...input, hospitalId: ctx.hospitalId }).returning();
    return row;
  });
}
export async function listConditionsForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) => tx.select().from(conditions).where(eq(conditions.patientId, patientId)));
}

export interface CreateObservationInput {
  patientId: string;
  encounterId?: string;
  code: string;
  value?: unknown;
  effectiveAt?: Date;
}
export async function createObservation(ctx: TenantContext, input: CreateObservationInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(observations).values({ ...input, hospitalId: ctx.hospitalId }).returning();
    return row;
  });
}
export async function listObservationsForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) => tx.select().from(observations).where(eq(observations.patientId, patientId)));
}

export interface CreateMedicationInput {
  patientId: string;
  encounterId?: string;
  name: string;
  dosage?: string;
  status?: string;
}
export async function createMedication(ctx: TenantContext, input: CreateMedicationInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(medications).values({ ...input, hospitalId: ctx.hospitalId }).returning();
    return row;
  });
}
export async function listMedicationsForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) => tx.select().from(medications).where(eq(medications.patientId, patientId)));
}

export interface CreateCarePlanInput {
  patientId: string;
  encounterId?: string;
  title: string;
  description?: string;
  status?: string;
}
export async function createCarePlan(ctx: TenantContext, input: CreateCarePlanInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(carePlans).values({ ...input, hospitalId: ctx.hospitalId }).returning();
    return row;
  });
}
export async function listCarePlansForPatient(ctx: TenantContext, patientId: string) {
  return withTenant(ctx, async (tx) => tx.select().from(carePlans).where(eq(carePlans.patientId, patientId)));
}
