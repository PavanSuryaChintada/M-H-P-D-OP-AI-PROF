// Doc 23 R1/R2 — the always-on worker (Railway), separate from the Vercel
// web process. Runs, per hospital, on an interval: scheduler tick (claim +
// simulate the call — see below), the lease reaper, the event dispatcher,
// and the EHR retry worker.
//
// Real-time telephony is explicitly out of scope for this build (doc 10's
// own stated scope), so a claimed task has nothing else to place a real
// call. Rather than let claimed tasks sit until lease expiry and cycle
// forever in a live deployment — a bad "watch the queue move" demo
// experience and arguably worse than not claiming at all — this worker
// immediately runs the claimed task through the real runCall() pipeline
// with a randomly-picked scripted persona (lib/sim/call-simulator.ts),
// the same mechanism doc 08's `npm run sim` uses for local demos. This is
// a deliberate scope decision for deployment specifically, documented
// here: the QUEUE mechanics, consensus, escalation, and documentation
// pipeline that run afterward are all real; only the "person answering
// the phone" is scripted, exactly as it is everywhere else in this build.
//
// Generic follow-up questions and red flags are used for every call
// rather than each patient's actual assigned protocol — wiring doc 11's
// full retrieval into the always-on worker is a larger integration than
// doc 23's deployment scope justifies in the time remaining; documented
// as a known simplification, not a silent gap.

import { listHospitals, getHospitalById } from "../lib/db/repositories/hospitals";
import { getPatientById } from "../lib/db/repositories/patients";
import { runSchedulerTick } from "../lib/queue/scheduler";
import { reapExpiredLeases, getTaskById } from "../lib/db/repositories/outreach-tasks";
import { drainEvents } from "../lib/events/dispatcher";
import { retryFailedEhrSyncs } from "../lib/ehr/retry-worker";
import { recordHeartbeat } from "../lib/db/repositories/workers";
import { createShutdownController, installShutdownHandler } from "../lib/reliability/shutdown";
import { runCall } from "../lib/voice-intake/run-call";
import { buildPersonaResponder, type PersonaName } from "../sim/call-simulator";
import { systemContext } from "../lib/db/system-context";
import { log, runWithOperationId } from "../lib/obs/logger";
import type { FollowUpQuestion } from "../lib/protocols/schema";
import type { RedFlag } from "../lib/ai/assessors/rule-engine";

const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;
const TICK_INTERVAL_MS = Number(process.env.WORKER_TICK_INTERVAL_MS ?? 15_000);

/**
 * Full error detail for logging - `err.message` alone hides exactly the
 * fields you need to tell "wrong DATABASE_URL_POOLED" apart from "Supabase
 * project is paused" apart from "network blocked": postgres.js/Postgres
 * errors carry a `code` (e.g. 28P01 = bad password, ECONNREFUSED/ENOTFOUND
 * for network failures), plus detail/hint/table/column when the DB itself
 * rejected the query. Fields are read defensively since a plain JS Error
 * (not from postgres.js) won't have most of them.
 */
function describeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: String(err) };
  const pgFields = ["code", "detail", "hint", "schema_name", "table_name", "column_name", "constraint_name", "routine", "severity", "errno", "syscall", "address", "port"] as const;
  const extra: Record<string, unknown> = {};
  for (const key of pgFields) {
    const value = (err as unknown as Record<string, unknown>)[key];
    if (value !== undefined) extra[key] = value;
  }
  // Drizzle wraps the real postgres.js/network error in `Error("Failed
  // query: ...", { cause })` - the wrapper's own message is never the
  // actual reason (bad password, ENOTFOUND, timeout, etc.), only `.cause`
  // is. Without unwrapping it every log just says "Failed query" forever.
  const cause = (err as { cause?: unknown }).cause;
  return {
    error: err.message,
    errorName: err.name,
    stack: err.stack,
    ...extra,
    ...(cause !== undefined ? { cause: describeError(cause) } : {}),
  };
}

// Excludes "injection" (a deliberate adversarial test persona, not a
// realistic default call mix) — everything else, including emergency and
// red_flag, so a live demo genuinely exercises escalation end to end.
const DEMO_PERSONAS: PersonaName[] = ["cooperative", "terse", "confused", "talkative", "red_flag", "emergency", "callback_requester", "refuser", "wrong_person"];

const GENERIC_QUESTIONS: FollowUpQuestion[] = [
  { id: "Q1", text: "How is your pain level today, on a scale of mild, moderate, or severe?", answerType: "text", probeQuestions: [{ id: "Q1-P1", text: "Has it gotten better or worse since discharge?" }] },
  { id: "Q2", text: "Have you been able to follow your discharge instructions, including any medications?", answerType: "yes_no", probeQuestions: [{ id: "Q2-P1", text: "What's made that difficult?" }] },
];

const GENERIC_RED_FLAGS: RedFlag[] = [
  { id: "RF-CHEST", description: "chest pain", triggerKeywords: ["chest pain", "pressure in my chest"], severity: "high", protocolId: "worker-generic-v1", protocolVersion: "1", chunkId: "chunk-chest" },
  { id: "RF-BREATH", description: "shortness of breath", triggerKeywords: ["can't breathe", "trouble breathing", "shortness of breath"], severity: "high", protocolId: "worker-generic-v1", protocolVersion: "1", chunkId: "chunk-breath" },
  { id: "RF-DVT", description: "possible DVT", triggerKeywords: ["calf is swollen", "calf pain and swelling"], severity: "moderate", protocolId: "worker-generic-v1", protocolVersion: "1", chunkId: "chunk-dvt" },
  { id: "RF-FEVER", description: "fever", triggerKeywords: ["running a fever", "temperature is 10"], severity: "moderate", protocolId: "worker-generic-v1", protocolVersion: "1", chunkId: "chunk-fever" },
];

function pickPersona(): PersonaName {
  return DEMO_PERSONAS[Math.floor(Math.random() * DEMO_PERSONAS.length)];
}

async function simulateClaimedCall(hospitalId: string, taskId: string, campaignId: string): Promise<void> {
  const ctx = systemContext(hospitalId);
  const [task, hospital] = await Promise.all([getTaskById(ctx, taskId), getHospitalById(hospitalId)]);
  if (!task || !hospital) return;
  const patient = await getPatientById(ctx, task.patientId);
  if (!patient) return;

  try {
    const result = await runCall({
      ctx,
      hospitalName: hospital.name,
      patientFirstName: patient.firstName,
      outreachTaskId: taskId,
      campaignId,
      followUpQuestions: GENERIC_QUESTIONS,
      redFlags: GENERIC_RED_FLAGS,
      patientResponder: buildPersonaResponder(pickPersona()),
    });
    log("info", "worker.simulated_call", { hospitalId, taskId, outcome: result.outcome, emergencyTriggered: result.emergencyTriggered });
  } catch (err) {
    log("error", "worker.simulated_call_failed", { hospitalId, taskId, ...describeError(err) });
  }
}

async function tickOneHospital(hospitalId: string): Promise<void> {
  await recordHeartbeat(systemContext(hospitalId), WORKER_ID);

  const tick = await runSchedulerTick(hospitalId, WORKER_ID);
  for (const claimed of tick.claimed) {
    await simulateClaimedCall(hospitalId, claimed.id, claimed.campaignId);
  }

  const reaped = await reapExpiredLeases(hospitalId);
  if (reaped.length > 0) log("info", "worker.reaped", { hospitalId, count: reaped.length });

  await drainEvents(hospitalId, 20);
  await retryFailedEhrSyncs(hospitalId);
}

async function tick(shutdown: ReturnType<typeof createShutdownController>): Promise<void> {
  if (shutdown.isShuttingDown()) return;

  // This is the control-plane query every tick starts with - if the DB is
  // unreachable (wrong DATABASE_URL_POOLED, a paused Supabase project, a
  // blocked port), it must not take the whole process down with it. Log
  // everything needed to diagnose it and skip this tick; the next tick
  // retries automatically, which is what you want for a transient/
  // recoverable condition (e.g. a free-tier Supabase project waking back up
  // takes the first query down but the next one a few seconds later
  // succeeds) instead of crash-looping the container over and over.
  let hospitalList: Awaited<ReturnType<typeof listHospitals>>;
  try {
    hospitalList = await listHospitals();
  } catch (err) {
    log("error", "worker.list_hospitals_failed", describeError(err));
    return;
  }

  for (const hospital of hospitalList) {
    if (shutdown.isShuttingDown()) break;
    const work = runWithOperationId(() => tickOneHospital(hospital.id));
    shutdown.registerInFlight(work);
    try {
      await work;
    } catch (err) {
      log("error", "worker.tick_failed", { hospitalId: hospital.id, ...describeError(err) });
    }
  }
}

async function main() {
  log("info", "worker.started", { workerId: WORKER_ID, tickIntervalMs: TICK_INTERVAL_MS });

  let shutdown: ReturnType<typeof createShutdownController>;
  try {
    shutdown = createShutdownController(async () => log("info", "worker.shutdown_complete", { workerId: WORKER_ID }));
    installShutdownHandler(shutdown);
  } catch (err) {
    log("error", "worker.init_failed", describeError(err));
    throw err;
  }

  while (!shutdown.isShuttingDown()) {
    try {
      await tick(shutdown);
    } catch (err) {
      // tick() already catches its own known failure points (listHospitals,
      // per-hospital work) - this is a last-resort net for anything that
      // still escapes it, logged in full rather than silently killing the
      // loop's next iteration.
      log("error", "worker.tick_uncaught", describeError(err));
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
  }
}

main().catch((err) => {
  log("error", "worker.fatal", describeError(err));
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log("error", "worker.unhandled_rejection", describeError(reason));
});
process.on("uncaughtException", (err) => {
  log("error", "worker.uncaught_exception", describeError(err));
});
