// Doc 02 acceptance criteria, exercised against the real route handlers and
// the live database (only the Supabase Auth boundary is mocked — everything
// downstream of "who is this" runs for real: getCurrentAppUser,
// resolveTenantContext, the permission matrix, and the DB).
//
//   "A CAMPAIGN_MANAGER token cannot resolve an escalation (403) or read
//    another hospital (404, not 403 — do not leak existence)."

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import { createUser, assignHospitalRole } from "../lib/db/repositories/users";
import type { Role } from "../lib/db/tenant";

const currentAuthUser = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: currentAuthUser.id ? { id: currentAuthUser.id } : null },
      }),
    },
  }),
}));

// Imported after the mock is declared — vi.mock is hoisted by Vitest's
// transform regardless of source order, so this works either way, but
// writing it below keeps the intent readable.
const { guard, guardPlatformAdmin } = await import("../lib/auth/guard");

const admin = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

let hospitalA: { id: string };
let hospitalB: { id: string };
const authIds: Record<string, string> = {};
const appUserIds: Record<string, string> = {};

async function actingAs(key: string) {
  currentAuthUser.id = authIds[key];
}

beforeAll(async () => {
  hospitalA = await createHospital({ name: "RBAC Test Hospital A", timezone: "Asia/Kolkata" });
  hospitalB = await createHospital({ name: "RBAC Test Hospital B", timezone: "Asia/Kolkata" });

  const roles: Role[] = ["HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "CLINICAL_REVIEWER"];
  for (const role of roles) {
    const authId = crypto.randomUUID();
    authIds[role] = authId;
    const user = await createUser({
      email: `${role.toLowerCase()}@rbac-test.local`,
      displayName: role,
      authProviderId: authId,
    });
    appUserIds[role] = user.id;
    await assignHospitalRole({ userId: user.id, hospitalId: hospitalA.id, role });
  }

  const paAuthId = crypto.randomUUID();
  authIds.PLATFORM_ADMIN = paAuthId;
  const paUser = await createUser({
    email: "platform-admin@rbac-test.local",
    displayName: "PLATFORM_ADMIN",
    authProviderId: paAuthId,
    isPlatformAdmin: true,
  });
  appUserIds.PLATFORM_ADMIN = paUser.id;
});

afterAll(async () => {
  await admin`delete from user_hospital_roles where hospital_id in (${hospitalA.id}, ${hospitalB.id})`;
  // A bare ${array} would serialize as a Postgres array literal, not an
  // expanded IN-list — sql(array) is postgres.js's helper for the latter.
  await admin`delete from users where id in ${admin(Object.values(appUserIds))}`;
  await admin`delete from hospitals where id in (${hospitalA.id}, ${hospitalB.id})`;
  await admin.end();
});

describe("unauthenticated", () => {
  it("guard() returns 401 with no session", async () => {
    currentAuthUser.id = null;
    const result = await guard(hospitalA.id, "hospital:read");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("guardPlatformAdmin() returns 401 with no session", async () => {
    currentAuthUser.id = null;
    const result = await guardPlatformAdmin("hospital:create");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

describe("HOSPITAL_ADMIN", () => {
  it("can read its own hospital (200-equivalent: a TenantContext, not a Response)", async () => {
    await actingAs("HOSPITAL_ADMIN");
    const result = await guard(hospitalA.id, "hospital:read");
    expect(result).not.toBeInstanceOf(Response);
  });

  it("gets 404, not 403, reading a hospital it has no role at", async () => {
    await actingAs("HOSPITAL_ADMIN");
    const result = await guard(hospitalB.id, "hospital:read");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it("gets 403 creating a hospital (PLATFORM_ADMIN-only)", async () => {
    await actingAs("HOSPITAL_ADMIN");
    const result = await guardPlatformAdmin("hospital:create");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });
});

describe("CAMPAIGN_MANAGER cannot resolve an escalation", () => {
  it("gets 403, not a TenantContext", async () => {
    await actingAs("CAMPAIGN_MANAGER");
    const result = await guard(hospitalA.id, "escalation:resolve");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });
});

describe("CLINICAL_REVIEWER can resolve an escalation", () => {
  it("is granted a TenantContext", async () => {
    await actingAs("CLINICAL_REVIEWER");
    const result = await guard(hospitalA.id, "escalation:resolve");
    expect(result).not.toBeInstanceOf(Response);
  });
});

describe("PLATFORM_ADMIN", () => {
  it("can create a hospital", async () => {
    await actingAs("PLATFORM_ADMIN");
    const result = await guardPlatformAdmin("hospital:create");
    expect(result).not.toBeInstanceOf(Response);
  });

  it("still gets 404 reading a hospital it holds no explicit role at — global admin status alone doesn't grant guard() access", async () => {
    await actingAs("PLATFORM_ADMIN");
    const result = await guard(hospitalA.id, "hospital:read");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });
});
