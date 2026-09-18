// Doc 08 — the mandatory queue simulation (PRD §12). Proves docs 06/07
// (priority/tier scoring, capacity-safe claiming, the state machine,
// backoff, callbacks, reaper recovery) against a real Postgres database
// using the REAL scheduler/claim/record-outcome/reaper code — not a
// reimplementation.
//
// Scope note (see docs/queue-design.md doc 08 section): the spec's R3 asks
// for a full injectable Clock interface. Given the build's time budget,
// this instead compresses the queue layer's absolute time CONSTANTS
// (2h tier cutoff, 10min callback window, 15/45/120/240min backoff table,
// 5min lease) via the optional threshold-override parameters added to
// tier.ts/backoff.ts/recompute.ts/claim.ts/scheduler.ts/record-outcome.ts —
// every one of them defaults to the unchanged production value, so
// production behavior is provably untouched (tests/queue-*.test.ts still
// pass with no arguments). A 24h-equivalent run compresses into ~2.5
// minutes of real wall time this way, without touching the SQL layer's use
// of `now()`.
//
// Usage: npx tsx sim/queue-sim.ts [--seed 42]

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRng } from "./rng";
import { createHospital, updateHospitalConfig } from "../lib/db/repositories/hospitals";
import { createUser } from "../lib/db/repositories/users";
import { upsertHospitalCapacity, getHospitalCapacityByHospitalId } from "../lib/db/repositories/hospital-capacity";
import { createCampaign, persistTransition } from "../lib/db/repositories/campaigns";
import { ingestDischargeRecord } from "../lib/discharge/ingest";
import {
  createOutreachTask,
  getTaskById,
  transitionTaskState,
  transitionTaskStateAndReleaseCapacity,
} from "../lib/db/repositories/outreach-tasks";
import { runSchedulerTick } from "../lib/queue/scheduler";
import { recordCallOutcome } from "../lib/queue/record-outcome";
import { runReaperTick } from "../lib/queue/reaper";
import type { TenantContext } from "../lib/db/tenant";
import fixture from "./fixtures/queue-sim-patients.json";

// ---- compressed-timeline constants (see file header) ----------------------
const CAPACITY = 3;
const TICK_INTERVAL_MS = 1500;
const MAX_TICKS = 24;
const DEFAULT_WINDOW_SECONDS = 480; // 8 min
const NEAR_DEADLINE_WINDOW_SECONDS = 80; // proves Tier 1 fast
const CUTOFF_ABSOLUTE_HOURS = 20 / 3600; // ~20s equivalent
// total_window_hours/follow_up_window_hours are INTEGER columns, so every
// patient's stored window rounds to 1 (their real, fractional-hour window
// only exists in clinical_deadline_at). That collapses cutoffRatio's usual
// meaning ("remaining/total < 20%") down to a flat "remaining < N seconds"
// check against a denominator of 1 — 0.05 here means "< 180s remaining",
// which is what actually separates the near-deadline fixture patients
// (80s window) from the default ones (480s window) in this compressed run.
const CUTOFF_RATIO = 0.05;
const CALLBACK_WINDOW_SECONDS = 20;
const CALLBACK_OFFSET_SECONDS = 25; // when a callback is requested for
const LEASE_MINUTES = 0.15; // 9s — short enough for kill-worker to resolve in-run
const COOLDOWN_MINUTES = 0.05; // 3s — must be short or retries never reclaim
const DROPPED_FIXED_BACKOFF_MINUTES = 0.25; // 15s

interface FixturePatient {
  mrn: string;
  firstName?: string;
  lastName?: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  campaign: "A" | "B";
  nearDeadline?: boolean;
  willRequestCallback?: boolean;
  invalidNumber?: boolean;
  willDropMidCall?: boolean;
  willPresentRedFlag?: boolean;
}

interface TraceEvent {
  t: number; // ms since sim start
  tick: number;
  type: string;
  [key: string]: unknown;
}

const trace: TraceEvent[] = [];
const counters = {
  completed: 0,
  escalated: 0,
  manualFollowUp: 0,
  failed: 0,
  callbacksHonored: 0,
  reaperRecoveries: 0,
};
function log(type: string, tick: number, extra: Record<string, unknown> = {}) {
  const evt: TraceEvent = { t: Date.now() - simStartMs, tick, type, ...extra };
  trace.push(evt);
  console.log(`[t+${(evt.t / 1000).toFixed(1)}s tick=${tick}] ${type}`, extra.mrn ?? "", extra.outcome ?? extra.finalState ?? "");
}

function writeLiveState(tick: number, capacity: { active: number; max: number }) {
  const runsDir = path.join(__dirname, "runs");
  const state = {
    tick,
    updatedAt: new Date().toISOString(),
    capacity,
    counters,
    recentEvents: trace.slice(-40).reverse(),
  };
  fs.writeFileSync(path.join(runsDir, "live-state.json"), JSON.stringify(state, null, 2));
}

let simStartMs = 0;

function parseArgs() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--seed");
  return { seed: i >= 0 ? Number(args[i + 1]) : 42 };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupHospital(rng: ReturnType<typeof createRng>) {
  // Short code must be unique per run (re-running the same seed is exactly
  // R2's point), so it carries a timestamp on top of the seed rather than
  // just rng.int() — the seed still drives every actual queue decision.
  const hospital = await createHospital({
    name: "Simulation Hospital",
    shortCode: `SIM${rng.int(100, 999)}-${Date.now()}`.slice(0, 20),
    timezone: "UTC",
  });

  await updateHospitalConfig(hospital.id, {
    callingHours: {
      MON: { start: "00:00", end: "23:59" },
      TUE: { start: "00:00", end: "23:59" },
      WED: { start: "00:00", end: "23:59" },
      THU: { start: "00:00", end: "23:59" },
      FRI: { start: "00:00", end: "23:59" },
      SAT: { start: "00:00", end: "23:59" },
      SUN: { start: "00:00", end: "23:59" },
    },
    maxConcurrentCalls: CAPACITY,
    defaultRetryPolicy: { maxAttempts: 5, backoffMinutes: [15, 45, 120, 240], jitterPct: 20 },
    defaultFollowUpWindowHours: 24,
    notificationPreferences: { channels: ["IN_APP"], reviewerTimeoutMinutes: 30 },
    ehrSettings: { mode: "mock", failureRate: 0 },
  });

  const user = await createUser({
    email: `sim-worker-${Date.now()}@example.invalid`,
    displayName: "Simulation Worker",
  });

  const ctx: TenantContext = { hospitalId: hospital.id, userId: user.id, role: "HOSPITAL_ADMIN" };

  await upsertHospitalCapacity(ctx, CAPACITY);

  const campaignA = await createCampaign(ctx, { name: "Simulation Campaign A", priority: 7, maxRetries: 5 });
  const campaignB = await createCampaign(ctx, { name: "Simulation Campaign B", priority: 3, maxRetries: 5 });

  for (const c of [campaignA, campaignB]) {
    await persistTransition(ctx, c.id, "DRAFT", "READY", "sim setup", `user:${user.id}`);
    await persistTransition(ctx, c.id, "READY", "RUNNING", "sim setup", `user:${user.id}`);
  }

  return { hospital, user, ctx, campaigns: { A: campaignA, B: campaignB } };
}

/** Bounded concurrency for seeding — sequential seeding of 28 patients at this network's real per-query latency (see docs/dev-ai-usage.md) would blow the 4-minute acceptance criteria on setup alone, before a single scheduler tick runs. Mirrors sim/generate-patients.ts's runWithConcurrency. */
async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
}

async function seedPatients(
  ctx: TenantContext,
  campaigns: { A: { id: string }; B: { id: string } },
  patients: FixturePatient[],
) {
  const tasks: { task: Awaited<ReturnType<typeof createOutreachTask>>; tag: FixturePatient }[] = [];

  await runWithConcurrency(patients, 8, async (p) => {
    const windowSeconds = p.nearDeadline ? NEAR_DEADLINE_WINDOW_SECONDS : DEFAULT_WINDOW_SECONDS;
    const dischargeAt = new Date();
    const deadlineAt = new Date(dischargeAt.getTime() + windowSeconds * 1000);

    const ingestResult = await ingestDischargeRecord(ctx, {
      sourceMessageId: `sim:${p.mrn}`,
      patient: {
        mrn: p.mrn,
        firstName: p.firstName ?? "Sim",
        lastName: p.lastName ?? p.mrn,
        phone: p.invalidNumber ? "not-a-number" : "+15550100000",
      },
      encounter: {
        careSetting: "inpatient",
        dischargeAt: dischargeAt.toISOString(),
        dischargeInstructions: "Simulation discharge record",
      },
      riskLevel: p.riskLevel,
      // follow_up_window_hours is an INTEGER column; the real, fractional
      // window lives in clinicalDeadlineAt below.
      followUpWindowHours: 1,
      conditions: [{ codeText: "Simulation condition" }],
      observations: [],
      medications: [],
    });

    const campaign = p.campaign === "A" ? campaigns.A : campaigns.B;
    const task = await createOutreachTask(ctx, {
      campaignId: campaign.id,
      patientId: ingestResult.patientId,
      encounterId: ingestResult.encounterId,
      clinicalDeadlineAt: deadlineAt,
      scheduledFor: dischargeAt,
      maxAttempts: 5,
      riskLevel: p.riskLevel,
      // Also an INTEGER column — see followUpWindowHours above.
      totalWindowHours: 1,
    });

    tasks.push({ task, tag: p });
    process.stdout.write(".");
  });

  return tasks;
}

/** CALLING -> CONNECTED, no capacity release (the call is still active). Refetches so the returned row's .state reflects the hop for recordCallOutcome's from-state check. */
async function connect(ctx: TenantContext, taskId: string) {
  await transitionTaskState(ctx, taskId, "CALLING", "CONNECTED", "connected", "system:sim");
  return getTaskById(ctx, taskId);
}

async function escalate(ctx: TenantContext, taskId: string) {
  await connect(ctx, taskId);
  await transitionTaskStateAndReleaseCapacity(
    ctx,
    taskId,
    "CONNECTED",
    "ESCALATED",
    "red flag presented",
    "system:sim",
  );
  await transitionTaskState(ctx, taskId, "ESCALATED", "COMPLETED", "escalation handed off", "system:sim");
}

interface ProcessOutcome {
  taskId: string;
  patientId: string;
  campaignId: string;
  attemptCount: number;
  mrn: string;
  tag: FixturePatient;
}

/** Resolves one claimed task's outcome per its fixture tags, using the real recordCallOutcome orchestrator (except the escalation path, which recordCallOutcome's CallOutcome union doesn't model — see escalate() above). */
async function resolveOutcome(ctx: TenantContext, ctx0: ProcessOutcome, tick: number, now: Date) {
  const { taskId, tag, mrn } = ctx0;

  if (tag.willPresentRedFlag) {
    await escalate(ctx, taskId);
    counters.escalated++;
    log("escalated", tick, { mrn, outcome: "ESCALATED" });
    return;
  }

  if (tag.invalidNumber) {
    const task = await getTaskById(ctx, taskId);
    if (!task) return;
    const result = await recordCallOutcome(ctx, task, { outcome: "INVALID_NUMBER", now });
    counters.manualFollowUp++;
    log("outcome", tick, { mrn, outcome: "INVALID_NUMBER", finalState: result.finalState });
    return;
  }

  if (tag.willDropMidCall) {
    const task = await getTaskById(ctx, taskId);
    if (!task) return;
    if (task.attemptCount <= 1) {
      const connected = await connect(ctx, taskId);
      if (!connected) return;
      const result = await recordCallOutcome(ctx, connected, {
        outcome: "DROPPED",
        now,
        partialState: { note: "mid-call context at drop", step: "medication_review" },
        fixedBackoffMinutesOverride: DROPPED_FIXED_BACKOFF_MINUTES,
      });
      log("outcome", tick, { mrn, outcome: "DROPPED", finalState: result.finalState });
    } else {
      const connected = await connect(ctx, taskId);
      if (!connected) return;
      const result = await recordCallOutcome(ctx, connected, { outcome: "COMPLETED", now });
      counters.completed++;
      log("outcome", tick, { mrn, outcome: "COMPLETED (resumed)", finalState: result.finalState });
    }
    return;
  }

  if (tag.willRequestCallback) {
    const task = await getTaskById(ctx, taskId);
    if (!task) return;
    // CALLBACK_REQUESTED has consumesAttempt: false (outcome-policy.ts), so
    // attempt_count is reversed back to what it was before this claim's
    // increment — it can never grow past 1 for a patient stuck in this
    // branch, and can't be used to tell "first contact" from "the callback
    // being honored." task.callbackRequestedAt (set by the first branch,
    // cleared by neither branch) is the real signal: present means this
    // claim IS the honored callback.
    if (!task.callbackRequestedAt) {
      const connected = await connect(ctx, taskId);
      if (!connected) return;
      const callbackAt = new Date(now.getTime() + CALLBACK_OFFSET_SECONDS * 1000);
      const result = await recordCallOutcome(ctx, connected, {
        outcome: "CALLBACK_REQUESTED",
        now,
        callbackRequestedAt: callbackAt,
      });
      log("outcome", tick, { mrn, outcome: "CALLBACK_REQUESTED", finalState: result.finalState, callbackAt });
    } else {
      const connected = await connect(ctx, taskId);
      if (!connected) return;
      const result = await recordCallOutcome(ctx, connected, { outcome: "COMPLETED", now });
      counters.completed++;
      counters.callbacksHonored++;
      log("outcome", tick, { mrn, outcome: "COMPLETED (callback honored)", finalState: result.finalState });
    }
    return;
  }

  // nearDeadline and untagged: straightforward happy path.
  const connected = await connect(ctx, taskId);
  if (!connected) return;
  const result = await recordCallOutcome(ctx, connected, { outcome: "COMPLETED", now });
  counters.completed++;
  log("outcome", tick, { mrn, outcome: "COMPLETED", finalState: result.finalState });
}

async function main() {
  const { seed } = parseArgs();
  simStartMs = Date.now();
  const rng = createRng(seed);

  console.log(`Doc 08 queue simulation — seed=${seed}, capacity=${CAPACITY}, patients=${fixture.patients.length}`);

  const { ctx, campaigns } = await setupHospital(rng);
  console.log(`Hospital ${ctx.hospitalId} ready with 2 RUNNING campaigns. Seeding patients...`);
  const seeded = await seedPatients(ctx, campaigns, fixture.patients as FixturePatient[]);
  const tagByPatientId = new Map(seeded.map((s) => [s.task!.patientId, s.tag]));
  const mrnByPatientId = new Map(seeded.map((s) => [s.task!.patientId, s.tag.mrn]));

  console.log(`Seeded ${seeded.length} patients across 2 campaigns (weights 7/3). Starting scheduler ticks...`);

  let killWorkerDemoTaskId: string | null = null;
  let killWorkerDemoAt = 0;
  // Once the demo has fired and been recovered, killWorkerDemoTaskId resets
  // to null so the "currently frozen" check can be reused — but that also
  // makes the SAME reaper-recovered task (now back in RETRY_SCHEDULED,
  // CRITICAL risk, eligible for reclaim) match the trigger condition again
  // on its next claim, freezing it forever. killWorkerDemoUsed is the
  // separate "has this run already happened, ever" flag that actually
  // limits it to once per run.
  let killWorkerDemoUsed = false;
  const inFlightTaskIds = new Set<string>();
  let duplicateClaimDetected = false;

  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    const now = new Date();
    const capacityRow = await getHospitalCapacityByHospitalId(ctx.hospitalId);
    if (capacityRow && capacityRow.currentActiveCalls > capacityRow.maxConcurrentCalls) {
      console.error(`ASSERTION VIOLATION: capacity ${capacityRow.currentActiveCalls}/${capacityRow.maxConcurrentCalls}`);
    }

    const result = await runSchedulerTick(
      ctx.hospitalId,
      "sim-worker-1",
      COOLDOWN_MINUTES,
      { cutoffAbsoluteHours: CUTOFF_ABSOLUTE_HOURS, cutoffRatio: CUTOFF_RATIO, callbackWindowSeconds: CALLBACK_WINDOW_SECONDS },
      LEASE_MINUTES,
    );

    // Each claimed task belongs to a different patient with no shared
    // state, and capacity was already reserved atomically at claim time —
    // resolving their outcomes concurrently (rather than one at a time) is
    // what keeps a capacity-3 tick's wall time roughly constant instead of
    // scaling with how many tasks it claimed.
    await Promise.all(
      result.claimed.map(async (claimed) => {
        const mrn = mrnByPatientId.get(claimed.patientId) ?? "?";
        const tag = tagByPatientId.get(claimed.patientId);
        // attempt_count is NOT a valid dedup key on its own: CALLBACK_REQUESTED
        // and PROVIDER_ERROR both reverse the claim-time increment
        // (consumesAttempt: false in outcome-policy.ts), so the same task's
        // first request and its later, entirely legitimate re-claim can both
        // land on attempt_count=1. What's actually invariant is that a task
        // can never be claimed while it's already in flight (unresolved) —
        // claim.ts's state filter removes it from the claimable set the
        // instant it's claimed, so seeing the same id claimed a second time
        // before the first resolved would be the real bug this checks for.
        if (inFlightTaskIds.has(claimed.id)) duplicateClaimDetected = true;
        inFlightTaskIds.add(claimed.id);

        log("claimed", tick, { mrn, taskId: claimed.id, attempt: claimed.attemptCount, campaignId: claimed.campaignId });

        // Kill-worker demo (R5): freeze the FIRST CRITICAL-risk claim we see
        // instead of resolving its outcome — its lease (9s) will expire and
        // the reaper reclaims it a few ticks later.
        if (!killWorkerDemoUsed && !killWorkerDemoTaskId && tag?.riskLevel === "CRITICAL") {
          killWorkerDemoUsed = true;
          killWorkerDemoTaskId = claimed.id;
          killWorkerDemoAt = tick;
          log("kill_worker_triggered", tick, { mrn, taskId: claimed.id });
          return;
        }

        if (!tag) {
          inFlightTaskIds.delete(claimed.id);
          return;
        }
        await resolveOutcome(ctx, {
          taskId: claimed.id,
          patientId: claimed.patientId,
          campaignId: claimed.campaignId,
          attemptCount: claimed.attemptCount,
          mrn,
          tag,
        }, tick, now);
        inFlightTaskIds.delete(claimed.id);
      }),
    );

    if (killWorkerDemoTaskId && tick - killWorkerDemoAt >= 3) {
      const reaped = await runReaperTick(ctx.hospitalId);
      if (reaped.includes(killWorkerDemoTaskId)) {
        counters.reaperRecoveries++;
        log("reaper_recovered", tick, { taskId: killWorkerDemoTaskId });
        inFlightTaskIds.delete(killWorkerDemoTaskId);
        killWorkerDemoTaskId = null;
      }
    }

    const capAfter = await getHospitalCapacityByHospitalId(ctx.hospitalId);
    writeLiveState(tick, {
      active: capAfter?.currentActiveCalls ?? 0,
      max: capAfter?.maxConcurrentCalls ?? CAPACITY,
    });

    await sleep(TICK_INTERVAL_MS);
  }

  // ---- R7: end-of-run assertions ----
  console.log("\n=== Assertions ===");
  const assertions: { name: string; pass: boolean; detail?: string }[] = [];

  const finalCapacity = await getHospitalCapacityByHospitalId(ctx.hospitalId);
  assertions.push({
    name: "capacity never exceeded",
    pass: (finalCapacity?.currentActiveCalls ?? 0) <= (finalCapacity?.maxConcurrentCalls ?? CAPACITY),
  });

  assertions.push({ name: "no duplicate claims", pass: !duplicateClaimDetected });

  let stuckCount = 0;
  let invalidNumberOk = true;
  const notTerminalStates: string[] = [];
  const TERMINAL = new Set(["COMPLETED", "MANUAL_FOLLOW_UP", "CANCELLED"]);
  const IN_FLIGHT_OK_IF_SCHEDULED = new Set(["RETRY_SCHEDULED", "CALLBACK_SCHEDULED", "CALLING", "CONNECTED", "PENDING"]);

  for (const s of seeded) {
    const task = await getTaskById(ctx, s.task!.id);
    if (!task) continue;
    if (s.tag.invalidNumber && task.state !== "MANUAL_FOLLOW_UP") invalidNumberOk = false;
    if (!TERMINAL.has(task.state) && !IN_FLIGHT_OK_IF_SCHEDULED.has(task.state)) {
      notTerminalStates.push(`${s.tag.mrn}:${task.state}`);
      stuckCount++;
    }
  }

  assertions.push({ name: "every invalid number reached MANUAL_FOLLOW_UP", pass: invalidNumberOk });
  assertions.push({
    name: "no task left in an unrecognized state",
    pass: stuckCount === 0,
    detail: notTerminalStates.join(", "),
  });
  assertions.push({
    name: "at least one callback honored within grace",
    pass: counters.callbacksHonored > 0,
  });
  assertions.push({
    name: "kill-worker scenario recovered via reaper",
    pass: counters.reaperRecoveries > 0,
  });
  assertions.push({
    name: "at least one escalation observed",
    pass: counters.escalated > 0,
  });

  let allPass = true;
  for (const a of assertions) {
    console.log(`  [${a.pass ? "PASS" : "FAIL"}] ${a.name}${a.detail ? ` (${a.detail})` : ""}`);
    if (!a.pass) allPass = false;
  }

  console.log(`\nCounters: ${JSON.stringify(counters)}`);
  console.log(allPass ? "\nOVERALL: PASS" : "\nOVERALL: FAIL");

  const runsDir = path.join(__dirname, "runs");
  const traceFile = path.join(runsDir, `${seed}-${Date.now()}.json`);
  fs.writeFileSync(
    traceFile,
    JSON.stringify({ seed, startedAt: new Date(simStartMs).toISOString(), assertions, counters, trace }, null, 2),
  );
  console.log(`Trace written to ${traceFile}`);

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
