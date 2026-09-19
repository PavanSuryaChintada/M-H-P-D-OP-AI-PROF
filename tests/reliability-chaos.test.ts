// Doc 20's required chaos test: 50 tasks, ~30% injected failure (split
// between call failures and simulated worker crashes), asserting zero
// duplicate calls, zero tasks left non-terminal (stuck in CALLING/
// CONNECTED), and zero leaked capacity once the reaper has run. This
// exercises the queue/capacity layer (doc 07) under randomized failure at
// scale — the specific "chaos at scale" property no single-scenario test
// elsewhere in this build covers. AI-failure→escalate (doc 12/13) and
// EHR-failure→retry (doc 15) each already have their own dedicated
// failure-injection tests in their own docs; duplicating those paths here
// wouldn't add reliability evidence, just runtime.

import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import { claimNextTask } from "../lib/queue/claim";
import { recordCallOutcome } from "../lib/queue/record-outcome";
import { reapExpiredLeases, getTaskById, transitionTaskState } from "../lib/db/repositories/outreach-tasks";
import type { TenantContext } from "../lib/db/tenant";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false, ssl: "require" });

const TASK_COUNT = 50;
const FAILURE_RATE = 0.3; // half of injected failures are call failures, half simulated worker crashes

// Deterministic PRNG (mulberry32) — reproducible chaos, not flaky chaos.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let hospital: { id: string };
let campaignId: string;
const ctx = (): TenantContext => ({ hospitalId: hospital.id, userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" });

beforeAll(async () => {
  hospital = await createHospital({ name: "Chaos Test Hospital", shortCode: `CHS-${Date.now()}`, timezone: "UTC" });
  // createHospital does not auto-create a hospital_capacity row — insert
  // one rather than update (an update against a nonexistent row silently
  // matches zero rows; see docs/dashboards-and-analytics.md for the same
  // mistake caught once already this build).
  await admin`insert into hospital_capacity (hospital_id, current_active_calls, max_concurrent_calls) values (${hospital.id}, 0, 10)`;
  const [campaign] = await admin`insert into campaigns (hospital_id, name, state, priority, max_retries) values (${hospital.id}, 'Chaos Campaign', 'RUNNING', 1, 5) returning id`;
  campaignId = campaign.id;

  for (let i = 0; i < TASK_COUNT; i++) {
    const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospital.id}, ${"CHAOS-" + i}, 'Chaos', 'Test') returning id`;
    await admin`insert into outreach_tasks (hospital_id, campaign_id, patient_id, clinical_deadline_at, scheduled_for, max_attempts, risk_level, total_window_hours)
      values (${hospital.id}, ${campaignId}, ${patient.id}, now() + interval '1 day', now(), 5, 'MEDIUM', 24)`;
  }
}, 60000);

describe("doc 20 chaos test — 50 tasks, ~30% injected failure", () => {
  it("zero duplicate calls, zero non-terminal tasks, zero leaked capacity", async () => {
    const rng = mulberry32(20260919);
    let claimedCount = 0;
    let crashedCount = 0;
    let failedCount = 0;
    let completedCount = 0;

    // Not "claim exactly 50" — a simulated crash never releases its
    // capacity slot until the reaper runs (after this loop, matching doc
    // 07's real recovery path), so enough accumulated crashes can
    // correctly exhaust capacity before every task is reachable in one
    // pass. That's a real property worth proving (capacity never
    // over-allocates even under a flood of unrecovered crashes), not a
    // bug to paper over with a fixed iteration count.
    for (let i = 0; i < TASK_COUNT; i++) {
      const claimed = await claimNextTask(hospital.id, "chaos-worker", [campaignId]);
      if (!claimed) break; // capacity-limited or nothing left claimable this round
      claimedCount++;

      const roll = rng();
      if (roll < FAILURE_RATE / 2) {
        // Simulated worker crash: never records an outcome, just backdates
        // the lease so the reaper (not this test) is what recovers it —
        // the actual doc 07 recovery path, not a shortcut around it.
        crashedCount++;
        await admin`update outreach_tasks set lease_expires_at = now() - interval '1 minute' where id = ${claimed.id}`;
        continue;
      }

      const task = await getTaskById(ctx(), claimed.id);
      if (!task) throw new Error("claimed task disappeared");

      if (roll < FAILURE_RATE) {
        failedCount++;
        await recordCallOutcome(ctx(), task, { outcome: "PROVIDER_ERROR" });
      } else {
        completedCount++;
        // COMPLETED is only reachable from CONNECTED, not directly from
        // CALLING (doc 10's own state-machine asymmetry) — connect first,
        // same as lib/voice-intake/run-call.ts's finishWithOutcome does.
        await transitionTaskState(ctx(), task.id, "CALLING", "CONNECTED", "connected", "system:chaos-worker");
        const connected = await getTaskById(ctx(), task.id);
        if (!connected) throw new Error("task disappeared");
        await recordCallOutcome(ctx(), connected, { outcome: "COMPLETED" });
      }
    }

    expect(claimedCount).toBe(crashedCount + failedCount + completedCount); // internal consistency
    expect(claimedCount).toBeGreaterThan(0);
    expect(crashedCount).toBeGreaterThan(0); // sanity: the chaos actually happened
    expect(failedCount).toBeGreaterThan(0);
    expect(completedCount).toBeGreaterThan(0);

    // Doc 07's actual recovery path — not simulated, the real reaper.
    const reaped = await reapExpiredLeases(hospital.id);
    expect(reaped.length).toBe(crashedCount);

    // Zero tasks left non-terminal: nothing should still be CALLING/CONNECTED.
    const stillInFlight = await admin`select count(*) from outreach_tasks where hospital_id = ${hospital.id} and state in ('CALLING','CONNECTED')`;
    expect(Number(stillInFlight[0].count)).toBe(0);

    // Zero leaked capacity.
    const [capacity] = await admin`select current_active_calls from hospital_capacity where hospital_id = ${hospital.id}`;
    expect(capacity.current_active_calls).toBe(0);

    // Zero duplicate calls: at most one calls row per (task, attempt_number) —
    // enforced by a real unique constraint, asserted here as an outcome, not just trusted.
    const dupes = await admin`
      select outreach_task_id, attempt_number, count(*) from calls
       where hospital_id = ${hospital.id}
       group by outreach_task_id, attempt_number having count(*) > 1
    `;
    expect(dupes.length).toBe(0);
  }, 120000); // 50 tasks x several DB round-trips each against the shared,
  // latency-heavy Supabase project (see vitest.config.ts) — a real time
  // budget, not a logic bug.
});
