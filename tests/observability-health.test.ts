// Doc 19 R6/R7 — worker heartbeats feed the health endpoint's stuck_workers
// count, and a missing heartbeat past the threshold is what "stuck" means.

import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import { recordHeartbeat, countStuckWorkers } from "../lib/db/repositories/workers";
import { getSystemHealth } from "../lib/obs/health";
import type { TenantContext } from "../lib/db/tenant";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false });

let hospital: { id: string };
const ctx = (): TenantContext => ({ hospitalId: hospital.id, userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" });

beforeAll(async () => {
  hospital = await createHospital({ name: "Health Test Hospital", shortCode: `HLT-${Date.now()}`, timezone: "UTC" });
});

describe("worker heartbeats (doc 19 R7)", () => {
  it("a fresh heartbeat is never counted as stuck", async () => {
    await recordHeartbeat(ctx(), "worker-fresh");
    expect(await countStuckWorkers(hospital.id, 90)).toBe(0);
  });

  it("a heartbeat older than the threshold counts as stuck", async () => {
    await recordHeartbeat(ctx(), "worker-stale");
    await admin`update workers set last_heartbeat_at = now() - interval '200 seconds' where hospital_id = ${hospital.id} and worker_id = 'worker-stale'`;
    expect(await countStuckWorkers(hospital.id, 90)).toBeGreaterThanOrEqual(1);
  });
});

describe("system health (doc 19 R6)", () => {
  it("returns the exact shape from the spec, with a real database check", async () => {
    const health = await getSystemHealth();
    expect(["HEALTHY", "DEGRADED", "UNAVAILABLE"]).toContain(health.status);
    expect(health.components.database).toBe("HEALTHY"); // the DB really is up during this test
    expect(health.queue).toHaveProperty("active_calls");
    expect(health.queue).toHaveProperty("capacity");
    expect(health.queue).toHaveProperty("pending");
    expect(health.queue).toHaveProperty("oldest_pending_minutes");
    expect(health.queue).toHaveProperty("cutoff_risk");
    expect(health.queue).toHaveProperty("failed");
    expect(health.queue).toHaveProperty("stuck_workers");
  }, 60000);
});
