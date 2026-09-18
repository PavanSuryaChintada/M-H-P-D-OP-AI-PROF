// Doc 07 — recordCallOutcome against the live DB: retry scheduling,
// PROVIDER_ERROR not consuming an attempt, DECLINED -> COMPLETED,
// INVALID_NUMBER -> MANUAL_FOLLOW_UP, capacity released, max-attempts ->
// MANUAL_FOLLOW_UP, and dropped-call partial_state round-tripping.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital, updateHospitalConfig } from "../lib/db/repositories/hospitals";
import { getTaskById } from "../lib/db/repositories/outreach-tasks";
import { recordCallOutcome } from "../lib/queue/record-outcome";
import { getMostRecentCallForTask } from "../lib/db/repositories/calls";
import { HospitalConfigSchema } from "../lib/hospitals/config-schema";
import type { TenantContext } from "../lib/db/tenant";
import type { outreachTasks } from "../lib/db/schema";

type Task = typeof outreachTasks.$inferSelect;

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false });

let hospital: { id: string };
let campaignId: string;
let patientId: string;
const ctx = (): TenantContext => ({ hospitalId: hospital.id, userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" });

const ALWAYS_OPEN_CONFIG = HospitalConfigSchema.parse({
  callingHours: {
    MON: { start: "00:00", end: "23:59" },
    TUE: { start: "00:00", end: "23:59" },
    WED: { start: "00:00", end: "23:59" },
    THU: { start: "00:00", end: "23:59" },
    FRI: { start: "00:00", end: "23:59" },
    SAT: { start: "00:00", end: "23:59" },
    SUN: { start: "00:00", end: "23:59" },
  },
  maxConcurrentCalls: 10,
  defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60], jitterPct: 10 },
  defaultFollowUpWindowHours: 168,
  notificationPreferences: { channels: ["IN_APP"], reviewerTimeoutMinutes: 30 },
  ehrSettings: { mode: "mock", failureRate: 0 },
});

beforeAll(async () => {
  hospital = await createHospital({ name: "Outcome Test Hospital", shortCode: `OUT-${Date.now()}`, timezone: "UTC" });
  await updateHospitalConfig(hospital.id, ALWAYS_OPEN_CONFIG);
  await admin`insert into hospital_capacity (hospital_id, max_concurrent_calls, current_active_calls) values (${hospital.id}, 10, 3)`;

  const [campaign] = await admin`insert into campaigns (hospital_id, name, state, priority, max_retries) values (${hospital.id}, 'Outcome Test Campaign', 'RUNNING', 1, 3) returning id`;
  campaignId = campaign.id;
  const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospital.id}, 'OUT-P1', 'Out', 'Come') returning id`;
  patientId = patient.id;
});

afterAll(async () => {
  if (hospital) {
    await admin`delete from calls where hospital_id = ${hospital.id}`;
    await admin`delete from outreach_task_state_transitions where hospital_id = ${hospital.id}`;
    await admin`delete from outreach_tasks where hospital_id = ${hospital.id}`;
    await admin`delete from hospital_capacity where hospital_id = ${hospital.id}`;
    await admin`delete from campaigns where hospital_id = ${hospital.id}`;
    await admin`delete from patients where hospital_id = ${hospital.id}`;
    await admin`delete from hospitals where id = ${hospital.id}`.catch(() => {});
  }
  await admin.end();
});

// Raw SQL returns snake_case columns; recordCallOutcome expects the
// drizzle-mapped camelCase Task shape, so this fetches back through the
// repository rather than trusting the INSERT's own RETURNING row.
async function makeTask(overrides: Partial<Task> = {}): Promise<Task> {
  const [inserted] = await admin`
    insert into outreach_tasks (
      hospital_id, campaign_id, patient_id, state, clinical_deadline_at,
      total_window_hours, attempt_count, max_attempts
    )
    values (
      ${hospital.id}, ${campaignId}, ${patientId}, 'CALLING',
      now() + interval '7 days', 168, 1, 3
    )
    returning id
  `;
  const task = await getTaskById(ctx(), inserted.id);
  if (!task) throw new Error("failed to fetch inserted task");
  return { ...task, ...overrides };
}

async function getCapacity() {
  const [row] = await admin`select current_active_calls from hospital_capacity where hospital_id = ${hospital.id}`;
  return row.current_active_calls;
}

describe(
  "recordCallOutcome",
  () => {
    it("NO_ANSWER schedules a retry and releases capacity", async () => {
      const before = await getCapacity();
      const task = await makeTask();
      const result = await recordCallOutcome(ctx(), task, { outcome: "NO_ANSWER" });
      expect(result.finalState).toBe("RETRY_SCHEDULED");
      expect(result.scheduledFor).toBeInstanceOf(Date);
      expect(await getCapacity()).toBe(before - 1);
    });

    it("DECLINED moves straight to COMPLETED, never retries", async () => {
      const task = await makeTask();
      const result = await recordCallOutcome(ctx(), task, { outcome: "DECLINED" });
      expect(result.finalState).toBe("COMPLETED");
    });

    it("INVALID_NUMBER moves straight to MANUAL_FOLLOW_UP, never retries", async () => {
      const task = await makeTask();
      const result = await recordCallOutcome(ctx(), task, { outcome: "INVALID_NUMBER" });
      expect(result.finalState).toBe("MANUAL_FOLLOW_UP");
    });

    it("PROVIDER_ERROR retries and does NOT consume the attempt the claim counted", async () => {
      // claim.ts increments attempt_count unconditionally at claim time,
      // before the outcome is known — attempt_count=1 here represents
      // "this was claimed as attempt #1". Since PROVIDER_ERROR must not
      // consume that attempt, recordCallOutcome reverses the increment
      // back to 0, so the *next* real claim reuses attempt slot #1 rather
      // than skipping straight to #2.
      const task = await makeTask({ attemptCount: 1 });
      await recordCallOutcome(ctx(), task, { outcome: "PROVIDER_ERROR" });
      const [row] = await admin`select attempt_count, state from outreach_tasks where id = ${task.id}`;
      expect(row.attempt_count).toBe(0);
      expect(row.state).toBe("RETRY_SCHEDULED");
    });

    it("reaching max_attempts sends the task to MANUAL_FOLLOW_UP instead of retrying again", async () => {
      const task = await makeTask({ attemptCount: 3, maxAttempts: 3 });
      const result = await recordCallOutcome(ctx(), task, { outcome: "NO_ANSWER" });
      expect(result.finalState).toBe("MANUAL_FOLLOW_UP");
    });

    it("VOICEMAIL gives up after 2 attempts even if the campaign's general max_attempts is higher", async () => {
      const task = await makeTask({ attemptCount: 2, maxAttempts: 5 });
      const result = await recordCallOutcome(ctx(), task, { outcome: "VOICEMAIL" });
      expect(result.finalState).toBe("MANUAL_FOLLOW_UP");
    });

    it("DROPPED preserves partial_state, readable back on the next attempt", async () => {
      const task = await makeTask();
      const partialState = { answeredQuestions: ["pain level"], lastAgentUtterance: "how are you feeling" };
      await recordCallOutcome(ctx(), task, { outcome: "DROPPED", partialState });
      const call = await getMostRecentCallForTask(ctx(), task.id);
      expect(call?.partialState).toEqual(partialState);
    });

    it("CALLBACK_REQUESTED with a valid time moves to CALLBACK_SCHEDULED with that scheduled_for", async () => {
      // Per the doc 07 §1 diagram, CALLBACK_SCHEDULED is only reachable
      // from CONNECTED — a callback can only be requested once the patient
      // actually picked up, not from CALLING.
      const task = await makeTask({ state: "CONNECTED" });
      const requestedAt = new Date(Date.now() + 60 * 60 * 1000); // 1h from now, always-open hospital
      const result = await recordCallOutcome(ctx(), task, { outcome: "CALLBACK_REQUESTED", callbackRequestedAt: requestedAt });
      expect(result.finalState).toBe("CALLBACK_SCHEDULED");
      expect(result.scheduledFor?.getTime()).toBe(requestedAt.getTime());
    });

    it("CALLBACK_REQUESTED past the clinical window is refused, not silently scheduled", async () => {
      const task = await makeTask({ state: "CONNECTED", clinicalDeadlineAt: new Date(Date.now() + 60 * 60 * 1000) }); // 1h window
      const pastWindow = new Date(Date.now() + 24 * 60 * 60 * 1000); // requested 24h out
      await expect(
        recordCallOutcome(ctx(), task, { outcome: "CALLBACK_REQUESTED", callbackRequestedAt: pastWindow }),
      ).rejects.toThrow(/invalid/i);
    });
  },
  60000,
);
