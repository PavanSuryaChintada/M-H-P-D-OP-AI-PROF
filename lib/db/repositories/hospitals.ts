import { eq } from "drizzle-orm";
import { db } from "../client";
import { hospitals } from "../schema";

// hospitals is the tenant root — it has no hospital_id column and carries no
// RLS policy (it isn't in TENANT_TABLE_NAMES). Isolation here is enforced by
// RBAC alone (doc 02): only PLATFORM_ADMIN may create/list all hospitals;
// every other role only ever reaches a hospital it already holds a
// user_hospital_roles row for, which is where the real boundary lives.

export async function createHospital(input: { name: string; timezone: string }) {
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
