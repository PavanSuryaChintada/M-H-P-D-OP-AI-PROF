// Doc 07 acceptance criteria: "Kill a worker mid-call (SIGKILL). Within
// 60s the task is back to RETRY_SCHEDULED, capacity is released, and
// attempts did NOT increment." A literal SIGKILL isn't reproducible in a
// unit test in any meaningful way — what actually matters is state left
// behind by a worker that stops responding: a CALLING task with an
// expired lease and capacity still reserved. That's what this simulates
// directly, then proves the reaper's query recovers it correctly.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import { runReaperTick } from "../lib/queue/reaper";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false, ssl: "require" });

let hospital: { id: string };
let campaignId: string;
let patientId: string;

beforeAll(async () => {
  hospital = await createHospital({ name: "Reaper Test Hospital", shortCode: `REAP-${Date.now()}`, timezone: "UTC" });
  await admin`insert into hospital_capacity (hospital_id, max_concurrent_calls, current_active_calls) values (${hospital.id}, 10, 4)`;

  const [campaign] = await admin`insert into campaigns (hospital_id, name, state, priority, max_retries) values (${hospital.id}, 'Reaper Test Campaign', 'RUNNING', 1, 3) returning id`;
  campaignId = campaign.id;
  const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospital.id}, 'REAP-P1', 'Reap', 'Er') returning id`;
  patientId = patient.id;
});

afterAll(async () => {
  if (hospital) {
    await admin`delete from outreach_task_state_transitions where hospital_id = ${hospital.id}`;
    await admin`delete from outreach_tasks where hospital_id = ${hospital.id}`;
    await admin`delete from hospital_capacity where hospital_id = ${hospital.id}`;
    await admin`delete from campaigns where hospital_id = ${hospital.id}`;
    await admin`delete from patients where hospital_id = ${hospital.id}`;
    await admin`delete from hospitals where id = ${hospital.id}`.catch(() => {});
  }
  await admin.end();
});

describe(
  "reaper recovers a crashed worker's task",
  () => {
    it("a CALLING task with an expired lease goes back to RETRY_SCHEDULED, capacity is released, attempt_count is untouched", async () => {
      const [task] = await admin`
        insert into outreach_tasks (
          hospital_id, campaign_id, patient_id, state, clinical_deadline_at,
          claimed_by, claimed_at, lease_expires_at, attempt_count
        )
        values (
          ${hospital.id}, ${campaignId}, ${patientId}, 'CALLING', now() + interval '7 days',
          'worker-that-died', now() - interval '10 minutes', now() - interval '5 minutes', 1
        )
        returning id
      `;

      const capacityBefore = (await admin`select current_active_calls from hospital_capacity where hospital_id = ${hospital.id}`)[0].current_active_calls;

      const reapedIds = await runReaperTick(hospital.id);
      expect(reapedIds).toContain(task.id);

      const [row] = await admin`select state, attempt_count, claimed_by, lease_expires_at, last_error, scheduled_for from outreach_tasks where id = ${task.id}`;
      expect(row.state).toBe("RETRY_SCHEDULED");
      expect(row.attempt_count).toBe(1); // untouched — reaping is not the patient's fault
      expect(row.claimed_by).toBeNull();
      expect(row.lease_expires_at).toBeNull();
      expect(row.last_error).toBe("lease_expired");
      expect(new Date(row.scheduled_for).getTime()).toBeGreaterThan(Date.now());

      const capacityAfter = (await admin`select current_active_calls from hospital_capacity where hospital_id = ${hospital.id}`)[0].current_active_calls;
      expect(capacityAfter).toBe(capacityBefore - 1);

      const transitions = await admin`select from_state, to_state, reason from outreach_task_state_transitions where outreach_task_id = ${task.id}`;
      expect(transitions.some((t) => t.to_state === "RETRY_SCHEDULED" && t.reason === "lease_expired")).toBe(true);
    });

    it("a task with a still-valid lease is left alone", async () => {
      const [task] = await admin`
        insert into outreach_tasks (
          hospital_id, campaign_id, patient_id, state, clinical_deadline_at,
          claimed_by, claimed_at, lease_expires_at, attempt_count
        )
        values (
          ${hospital.id}, ${campaignId}, ${patientId}, 'CALLING', now() + interval '7 days',
          'worker-still-alive', now(), now() + interval '5 minutes', 1
        )
        returning id
      `;

      const reapedIds = await runReaperTick(hospital.id);
      expect(reapedIds).not.toContain(task.id);

      const [row] = await admin`select state from outreach_tasks where id = ${task.id}`;
      expect(row.state).toBe("CALLING");
    });
  },
  30000,
);
