// Doc 03 R5 acceptance criteria: "A hospital missing a protocol cannot be
// set READY, and the UI says exactly which item is missing." Exercises
// computeReadiness against real seeded fixtures on the live database.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital, updateHospitalConfig } from "../lib/db/repositories/hospitals";
import { createUser, assignHospitalRole } from "../lib/db/repositories/users";
import { addEscalationContact } from "../lib/db/repositories/escalation-contacts";
import { computeReadiness } from "../lib/hospitals/readiness";
import { HospitalConfigSchema } from "../lib/hospitals/config-schema";
import type { TenantContext } from "../lib/db/tenant";

const admin = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: "prefer" });
const paUserId = crypto.randomUUID(); // never actually looked up — readiness only needs an actor id for withTenant's app.user_id GUC

let hospital: { id: string };
let hospitalAdmin: { id: string };

const fullConfig = HospitalConfigSchema.parse({
  callingHours: { MON: { start: "09:00", end: "18:00" } },
  maxConcurrentCalls: 5,
  defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60], jitterPct: 10 },
  defaultFollowUpWindowHours: 72,
  notificationPreferences: { channels: ["IN_APP"], reviewerTimeoutMinutes: 30 },
  ehrSettings: { mode: "mock", failureRate: 0 },
});

beforeAll(async () => {
  hospital = await createHospital({
    name: "Readiness Test Hospital",
    shortCode: `RDY-${Date.now()}`,
    timezone: "Asia/Kolkata",
  });
  hospitalAdmin = await createUser({
    email: `readiness-admin-${Date.now()}@rbac-test.local`,
    displayName: "Readiness Admin",
  });
});

afterAll(async () => {
  // beforeAll may not have finished (e.g. it timed out) — don't compound
  // that failure with a fresh crash reading .id off an undefined fixture.
  if (hospital) {
    await admin`delete from escalation_contacts where hospital_id = ${hospital.id}`;
    await admin`delete from user_hospital_roles where hospital_id = ${hospital.id}`;
    await admin`delete from hospital_capacity where hospital_id = ${hospital.id}`;
    await admin`delete from hospitals where id = ${hospital.id}`;
  }
  if (hospitalAdmin) {
    await admin`delete from users where id = ${hospitalAdmin.id}`;
  }
  await admin.end();
});

describe("computeReadiness", () => {
  it("lists every missing requirement on a freshly created hospital", async () => {
    const result = await computeReadiness(paUserId, hospital.id);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("operating configuration");
    expect(result.missing).toContain("at least one hospital admin");
    expect(result.missing).toContain("at least one protocol");
    expect(result.missing).toContain("at least one escalation contact");
  });

  it("drops each requirement off the missing list as it's satisfied, and is never ready without a protocol", async () => {
    await updateHospitalConfig(hospital.id, fullConfig);
    let result = await computeReadiness(paUserId, hospital.id);
    expect(result.missing).not.toContain("operating configuration");
    expect(result.missing).toContain("at least one hospital admin");

    await assignHospitalRole({ userId: hospitalAdmin.id, hospitalId: hospital.id, role: "HOSPITAL_ADMIN" });
    result = await computeReadiness(paUserId, hospital.id);
    expect(result.missing).not.toContain("at least one hospital admin");
    expect(result.missing).toContain("at least one escalation contact");

    const ctx: TenantContext = { hospitalId: hospital.id, userId: hospitalAdmin.id, role: "HOSPITAL_ADMIN" };
    await addEscalationContact(ctx, {
      orderIndex: 0,
      role: "Charge Nurse",
      channel: "EMAIL",
      contactValue: "nurse@example.com",
      ackTimeoutMinutes: 15,
    });
    result = await computeReadiness(paUserId, hospital.id);
    expect(result.missing).not.toContain("at least one escalation contact");

    // Never READY without a protocol — doc 11 hasn't landed yet, so this
    // is the one requirement that can't be satisfied in this test.
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["at least one protocol"]);
  });
});
