// Doc 06 §Scoring cadence — the bulk SQL in lib/queue/recompute.ts must
// produce the same numbers as the pure lib/queue/priority.ts +
// lib/queue/tier.ts for equivalent inputs. This is the cross-check that
// catches the two implementations drifting apart.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import { recomputeScores } from "../lib/queue/recompute";
import { computeScore } from "../lib/queue/priority";
import { assignTier } from "../lib/queue/tier";

const admin = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

let hospital: { id: string };
let campaignId: string;
let patientId: string;
let taskId: string;

const CAMPAIGN_WEIGHT_RAW = 5; // sole RUNNING campaign -> normalized weight = 1.0
const TOTAL_WINDOW_HOURS = 24;
const HOURS_REMAINING = 6; // matches the spec's "patient C" case
const ATTEMPT_COUNT = 1;
const MAX_ATTEMPTS = 3;

beforeAll(async () => {
  hospital = await createHospital({
    name: "Recompute Test Hospital",
    shortCode: `RECMP-${Date.now()}`,
    timezone: "Asia/Kolkata",
  });

  const [campaign] = await admin`
    insert into campaigns (hospital_id, name, state, priority, max_retries)
    values (${hospital.id}, 'Recompute Test Campaign', 'RUNNING', ${CAMPAIGN_WEIGHT_RAW}, 3)
    returning id
  `;
  campaignId = campaign.id;

  const [patient] = await admin`
    insert into patients (hospital_id, mrn, first_name, last_name)
    values (${hospital.id}, 'RECMP-P1', 'Recompute', 'Test')
    returning id
  `;
  patientId = patient.id;

  const [task] = await admin`
    insert into outreach_tasks (
      hospital_id, campaign_id, patient_id, state,
      clinical_deadline_at, total_window_hours, risk_level,
      attempt_count, max_attempts, created_at
    )
    values (
      ${hospital.id}, ${campaignId}, ${patientId}, 'PENDING',
      now() + (${HOURS_REMAINING} || ' hours')::interval, ${TOTAL_WINDOW_HOURS}, 'HIGH',
      ${ATTEMPT_COUNT}, ${MAX_ATTEMPTS}, now()
    )
    returning id
  `;
  taskId = task.id;
});

afterAll(async () => {
  if (hospital) {
    await admin`delete from outreach_tasks where hospital_id = ${hospital.id}`;
    await admin`delete from campaigns where hospital_id = ${hospital.id}`;
    await admin`delete from patients where hospital_id = ${hospital.id}`;
    await admin`delete from hospitals where id = ${hospital.id}`.catch(() => {});
  }
  await admin.end();
});

describe("recomputeScores matches the pure computeScore/assignTier", () => {
  it(
    "bulk SQL and the pure function agree on priority_score and tier for the same task",
    async () => {
      await recomputeScores(hospital.id);

      const [row] = await admin`select priority_score, tier from outreach_tasks where id = ${taskId}`;

      // hoursSinceEligible is "now - created_at", which is ~0 at insert
      // time but a few seconds have elapsed by the time this assertion
      // runs — negligible relative to the /24 divisor, so this is stable.
      const expected = computeScore({
        timeRemainingHours: HOURS_REMAINING,
        totalWindowHours: TOTAL_WINDOW_HOURS,
        riskLevel: "HIGH",
        campaignWeight: 1.0, // sole RUNNING campaign
        hoursSinceEligible: 0,
        attempts: ATTEMPT_COUNT,
        maxAttempts: MAX_ATTEMPTS,
      });
      const expectedTier = assignTier({
        callbackRequestedAt: null,
        now: new Date(),
        timeRemainingHours: HOURS_REMAINING,
        totalWindowHours: TOTAL_WINDOW_HOURS,
      });

      expect(Number(row.priority_score)).toBeCloseTo(expected.score, 2);
      expect(row.tier).toBe(expectedTier);
    },
    30000,
  );
});
