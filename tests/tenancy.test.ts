// Doc 01 acceptance criteria:
//  - Hospital A context cannot read Hospital B rows, at repository level AND
//    via raw SQL with RLS on, even with a deliberately unfiltered query.
//  - Deleting from audit_log as the app role raises a permission error.
//
// Integration test — needs a real Supabase/Postgres database with
// migrations run (npm run db:migrate) and lib/db/rls.sql applied, and
// DATABASE_URL_POOLED pointing at the app_user role rls.sql creates (NOT
// the Supabase "postgres" superuser — RLS is inert for superusers, so
// running this against "postgres" would pass for the wrong reason).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { db } from "../lib/db/client";
import { hospitals, auditLog } from "../lib/db/schema";
import { withTenant, type TenantContext } from "../lib/db/tenant";
import { listPatients, createPatient } from "../lib/db/repositories/patients";

// app_user (what `db` connects as) is deliberately never granted DELETE —
// that's the R5/privilege model under test, not a bug. Cleanup therefore
// needs its own connection using the superuser-level DATABASE_URL.
const admin = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: "prefer" });

let hospitalA: { id: string };
let hospitalB: { id: string };
const userIdA = "00000000-0000-0000-0000-0000000000aa";
const userIdB = "00000000-0000-0000-0000-0000000000bb";

let ctxA: TenantContext;
let ctxB: TenantContext;

beforeAll(async () => {
  // hospitalA ends up permanently undeletable once the audit_log test below
  // writes a row referencing it (FK + append-only, by design) — so a fixed
  // shortCode collides with the previous run's leftover row. Suffix with a
  // timestamp to keep each run's fixtures unique.
  const suffix = Date.now();
  [hospitalA] = await db
    .insert(hospitals)
    .values({ name: "Tenancy Test Hospital A", shortCode: `TEN-A-${suffix}`, timezone: "Asia/Kolkata" })
    .returning();
  [hospitalB] = await db
    .insert(hospitals)
    .values({ name: "Tenancy Test Hospital B", shortCode: `TEN-B-${suffix}`, timezone: "Asia/Kolkata" })
    .returning();

  ctxA = { hospitalId: hospitalA.id, userId: userIdA, role: "HOSPITAL_ADMIN" };
  ctxB = { hospitalId: hospitalB.id, userId: userIdB, role: "HOSPITAL_ADMIN" };

  await createPatient(ctxA, { mrn: "A-001", firstName: "Alice", lastName: "Anderson" });
  await createPatient(ctxB, { mrn: "B-001", firstName: "Bob", lastName: "Brown" });
});

afterAll(async () => {
  // beforeAll may not have finished — don't compound that failure with a
  // fresh crash reading .id off an undefined fixture.
  if (hospitalA && hospitalB) {
    // Cascade manually — no ON DELETE CASCADE by design, so tests clean up
    // explicitly rather than relying on it in production schema. Runs on
    // the admin connection since app_user has no DELETE grant (see above).
    await admin`delete from patients where hospital_id in (${hospitalA.id}, ${hospitalB.id})`;
    // hospitalB is deletable; hospitalA is not, by the time the audit_log
    // describe block below runs — it writes a row referencing hospitalA,
    // and audit_log rows are permanent (R5), so the FK makes hospitalA
    // permanent too. That's the append-only guarantee working as intended,
    // not a leak to work around: leave hospitalA in place rather than
    // fight it.
    await admin`delete from hospitals where id = ${hospitalB.id}`;
  }
  await admin.end();
});

describe("tenant isolation", () => {
  it("repository layer: listPatients(ctxA) never returns hospital B rows", async () => {
    const rows = await listPatients(ctxA);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => p.hospitalId === hospitalA.id)).toBe(true);
  });

  it("raw SQL under RLS: a deliberately unfiltered SELECT still returns zero B rows for context A", async () => {
    const rows = await withTenant(ctxA, async (tx) => {
      // No WHERE clause at all — RLS, not application code, must narrow this.
      return tx.execute(sql`select * from patients`);
    });
    const bRows = (rows as unknown as { hospital_id: string }[]).filter(
      (r) => r.hospital_id === hospitalB.id,
    );
    expect(bRows.length).toBe(0);
  });

  it("context B cannot see context A's patient even by exact id", async () => {
    const [aPatient] = await listPatients(ctxA);
    const rows = await withTenant(ctxB, async (tx) =>
      tx.execute(sql`select * from patients where id = ${aPatient.id}`),
    );
    expect((rows as unknown[]).length).toBe(0);
  });
});

describe("audit_log append-only (R5)", () => {
  let logId: string;

  beforeAll(async () => {
    const [row] = await withTenant(ctxA, async (tx) =>
      tx
        .insert(auditLog)
        .values({
          hospitalId: hospitalA.id,
          actorUserId: null,
          action: "test.write",
          resourceType: "test",
        })
        .returning(),
    );
    logId = row.id;
  });

  // No cleanup here on purpose: the audit_log_immutable trigger blocks
  // UPDATE/DELETE for every role, not just app_user — that's the point of
  // R5 (append-only). This test row is permanent, same as any other audit
  // entry would be.

  it("deleting as the app role raises a permission error", async () => {
    await expect(
      withTenant(ctxA, async (tx) => tx.execute(sql`delete from audit_log where id = ${logId}`)),
    ).rejects.toThrow();
  });

  it("updating as the app role raises a permission error", async () => {
    await expect(
      withTenant(ctxA, async (tx) =>
        tx.execute(sql`update audit_log set action = 'tampered' where id = ${logId}`),
      ),
    ).rejects.toThrow();
  });
});
