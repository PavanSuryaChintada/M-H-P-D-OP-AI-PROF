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

// This network sees several seconds of round-trip latency per query to the
// Supabase pooler — running the independent setup calls below in parallel
// (rather than one giant sequential chain) keeps beforeAll's wall-clock
// time from multiplying with every fixture added.
beforeAll(async () => {
  // Suffixed so a leftover row from an interrupted previous run (or one
  // that picked up an audit_log reference somewhere and became permanent)
  // never collides with this run's shortCode.
  const suffix = Date.now();
  [hospitalA, hospitalB] = await Promise.all([
    createHospital({ name: "RBAC Test Hospital A", shortCode: `RBAC-A-${suffix}`, timezone: "Asia/Kolkata" }),
    createHospital({ name: "RBAC Test Hospital B", shortCode: `RBAC-B-${suffix}`, timezone: "Asia/Kolkata" }),
  ]);

  const roles: Role[] = ["HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "CLINICAL_REVIEWER"];
  await Promise.all(
    roles.map(async (role) => {
      const authId = crypto.randomUUID();
      authIds[role] = authId;
      const user = await createUser({
        email: `${role.toLowerCase()}@rbac-test.local`,
        displayName: role,
        authProviderId: authId,
      });
      appUserIds[role] = user.id;
      await assignHospitalRole({ userId: user.id, hospitalId: hospitalA.id, role });
    }),
  );

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
  // beforeAll may not have finished — don't compound that failure with a
  // fresh crash reading .id off an undefined fixture.
  if (hospitalA && hospitalB) {
    await admin`delete from user_hospital_roles where hospital_id in (${hospitalA.id}, ${hospitalB.id})`;
  }
  const userIds = Object.values(appUserIds);
  if (userIds.length > 0) {
    // A bare ${array} would serialize as a Postgres array literal, not an
    // expanded IN-list — sql(array) is postgres.js's helper for the latter.
    await admin`delete from users where id in ${admin(userIds)}`;
  }
  if (hospitalA && hospitalB) {
    await admin`delete from hospitals where id in (${hospitalA.id}, ${hospitalB.id})`;
  }
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

describe("doc 17 — escalation:view and escalation:assign", () => {
  it("CAMPAIGN_MANAGER cannot view the escalation queue (403) — narrower than the general queue:view", async () => {
    await actingAs("CAMPAIGN_MANAGER");
    const result = await guard(hospitalA.id, "escalation:view");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("HOSPITAL_ADMIN and CLINICAL_REVIEWER can both view the escalation queue", async () => {
    await actingAs("HOSPITAL_ADMIN");
    expect(await guard(hospitalA.id, "escalation:view")).not.toBeInstanceOf(Response);
    await actingAs("CLINICAL_REVIEWER");
    expect(await guard(hospitalA.id, "escalation:view")).not.toBeInstanceOf(Response);
  });

  it("CAMPAIGN_MANAGER cannot assign/acknowledge/request-info (403)", async () => {
    await actingAs("CAMPAIGN_MANAGER");
    const result = await guard(hospitalA.id, "escalation:assign");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("HOSPITAL_ADMIN and CLINICAL_REVIEWER can both assign/acknowledge/request-info", async () => {
    await actingAs("HOSPITAL_ADMIN");
    expect(await guard(hospitalA.id, "escalation:assign")).not.toBeInstanceOf(Response);
    await actingAs("CLINICAL_REVIEWER");
    expect(await guard(hospitalA.id, "escalation:assign")).not.toBeInstanceOf(Response);
  });

  it("HOSPITAL_ADMIN cannot resolve (403) — resolution is CLINICAL_REVIEWER-only even though it can assign", async () => {
    await actingAs("HOSPITAL_ADMIN");
    const result = await guard(hospitalA.id, "escalation:resolve");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
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
