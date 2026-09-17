import { eq } from "drizzle-orm";
import { db } from "../client";
import { hospitals } from "../schema";

// hospitals is the tenant root — it has no hospital_id column and carries no
// RLS policy (it isn't in TENANT_TABLE_NAMES). Isolation here is enforced by
// RBAC alone (doc 02): only PLATFORM_ADMIN may create/list all hospitals;
// every other role only ever reaches a hospital it already holds a
// user_hospital_roles row for, which is where the real boundary lives.

export interface CreateHospitalInput {
  name: string;
  shortCode: string;
  timezone: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
}

export async function createHospital(input: CreateHospitalInput) {
  const [row] = await db.insert(hospitals).values(input).returning();
  return row;
}

export async function getHospitalById(hospitalId: string) {
  const [row] = await db.select().from(hospitals).where(eq(hospitals.id, hospitalId));
  return row ?? null;
}

export async function listHospitals() {
  return db.select().from(hospitals);
}

/** Doc 03 acceptance criteria: a config change must take effect without a restart — this is a plain row update, read fresh on every scheduler tick. */
export async function updateHospitalConfig(hospitalId: string, config: unknown) {
  const [row] = await db
    .update(hospitals)
    .set({ config, updatedAt: new Date() })
    .where(eq(hospitals.id, hospitalId))
    .returning();
  return row ?? null;
}

export async function updateHospitalStatus(
  hospitalId: string,
  status: "CREATED" | "CONFIGURED" | "READY",
) {
  const [row] = await db
    .update(hospitals)
    .set({ status, updatedAt: new Date() })
    .where(eq(hospitals.id, hospitalId))
    .returning();
  return row ?? null;
}

