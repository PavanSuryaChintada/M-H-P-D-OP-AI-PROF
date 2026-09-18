// Doc 04 acceptance criteria:
//  - "A batch with 3 malformed rows out of 50 accepts 47 and reports 3 with
//    field-level reasons."
//  - "Test: ingesting the same batch twice yields the same row count."

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import { createUser, assignHospitalRole } from "../lib/db/repositories/users";
import { ingestDischargeRecord } from "../lib/discharge/ingest";
import type { DischargeRecord } from "../lib/discharge/schema";
import type { TenantContext } from "../lib/db/tenant";

const currentAuthUser = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentAuthUser.id ? { id: currentAuthUser.id } : null } }) },
  }),
}));

const { POST } = await import("../app/api/hospitals/[hospitalId]/discharges/route");

const admin = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

let hospital: { id: string };
let hospitalAdminAppUserId: string;
let ctx: TenantContext;

function makeRecord(index: number): DischargeRecord {
  return {
    sourceMessageId: `TEST-DISCH-${index}`,
    patient: { mrn: `TEST-MRN-${index}`, firstName: "Test", lastName: `Patient${index}` },
    encounter: { dischargeAt: new Date().toISOString() },
    riskLevel: "MEDIUM",
    followUpWindowHours: 72,
    conditions: [],
    observations: [],
    medications: [],
  };
}

function makeRequest(hospitalId: string, body: string) {
  return {
    text: async () => body,
  } as unknown as import("next/server").NextRequest;
}

beforeAll(async () => {
  hospital = await createHospital({
    name: "Discharge Ingestion Test Hospital",
    shortCode: `DIT-${Date.now()}`,
    timezone: "Asia/Kolkata",
  });

  const authId = crypto.randomUUID();
  const user = await createUser({
    email: `discharge-test-admin-${Date.now()}@rbac-test.local`,
    displayName: "Discharge Test Admin",
    authProviderId: authId,
  });
  hospitalAdminAppUserId = user.id;
  currentAuthUser.id = authId;

  await assignHospitalRole({ userId: hospitalAdminAppUserId, hospitalId: hospital.id, role: "HOSPITAL_ADMIN" });
  ctx = { hospitalId: hospital.id, userId: hospitalAdminAppUserId, role: "HOSPITAL_ADMIN" };
});

afterAll(async () => {
  // beforeAll may not have finished — don't compound that failure with a
  // fresh crash reading .id off an undefined fixture.
  if (hospital) {
    await admin`delete from encounters where hospital_id = ${hospital.id}`;
    await admin`delete from patients where hospital_id = ${hospital.id}`;
    await admin`delete from events where hospital_id = ${hospital.id}`;
    await admin`delete from user_hospital_roles where hospital_id = ${hospital.id}`;
  }
  if (hospitalAdminAppUserId) {
    await admin`delete from users where id = ${hospitalAdminAppUserId}`;
  }
  if (hospital) {
    await admin`delete from hospitals where id = ${hospital.id}`;
  }
  await admin.end();
});

describe("ingestDischargeRecord idempotency", () => {
  it("re-ingesting the same sourceMessageId does not duplicate rows", async () => {
    const record = makeRecord(1);
    const first = await ingestDischargeRecord(ctx, record);
    expect(first.status).toBe("created");

    const second = await ingestDischargeRecord(ctx, record);
    expect(second.status).toBe("already_ingested");
    expect(second.patientId).toBe(first.patientId);
    expect(second.encounterId).toBe(first.encounterId);

    const encounterRows = await admin`select id from encounters where source_message_id = ${record.sourceMessageId}`;
    expect(encounterRows.length).toBe(1);
  });
});

describe("POST /discharges batch endpoint", () => {
  it("accepts valid records and rejects malformed ones with field-level reasons, in one batch", async () => {
    const validRecords = Array.from({ length: 3 }, (_, i) => makeRecord(100 + i));
    const malformed = [
      { sourceMessageId: "BAD-1" /* missing patient */ },
      { sourceMessageId: "BAD-2", patient: { mrn: "X" /* missing firstName/lastName */ }, encounter: { dischargeAt: new Date().toISOString() }, riskLevel: "LOW", followUpWindowHours: 24 },
      { patient: { mrn: "Y", firstName: "A", lastName: "B" }, encounter: { dischargeAt: new Date().toISOString() }, riskLevel: "NOT_A_LEVEL", followUpWindowHours: 24 }, // invalid enum + missing sourceMessageId
    ];
    const body = JSON.stringify([...validRecords, ...malformed]);

    const response = await POST(makeRequest(hospital.id, body), { params: Promise.resolve({ hospitalId: hospital.id }) });
    const json = await response.json();

    expect(json.accepted.length).toBe(3);
    expect(json.rejected.length).toBe(3);
    for (const r of json.rejected) {
      expect(typeof r.field).toBe("string");
      expect(typeof r.reason).toBe("string");
    }
  });

  it(
    "ingesting the same batch twice yields the same row count",
    async () => {
      const records = Array.from({ length: 10 }, (_, i) => makeRecord(200 + i));
      const body = JSON.stringify(records);

      await POST(makeRequest(hospital.id, body), { params: Promise.resolve({ hospitalId: hospital.id }) });
      const countAfterFirst = await admin`select count(*)::int as n from encounters where hospital_id = ${hospital.id} and source_message_id like 'TEST-DISCH-2%'`;

      await POST(makeRequest(hospital.id, body), { params: Promise.resolve({ hospitalId: hospital.id }) });
      const countAfterSecond = await admin`select count(*)::int as n from encounters where hospital_id = ${hospital.id} and source_message_id like 'TEST-DISCH-2%'`;

      expect(countAfterSecond[0].n).toBe(countAfterFirst[0].n);
      expect(countAfterFirst[0].n).toBe(10);
    },
    // 20 sequential ingests (10 records x 2 passes), each several DB round
    // trips — needs more than the global testTimeout on this network.
    90000,
  );
});
