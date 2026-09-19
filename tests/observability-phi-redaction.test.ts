// Doc 19 R2's required test: run a seeded call end to end, capture every
// log line the real production code path emits, and assert the seed
// patient's name and phone number never appear in any of it. Uses the real
// doc 10 runCall() (not a mock of the logger) against a patient whose
// first name is deliberately embedded in the agent's own greeting line
// (lib/voice-intake/run-call.ts: "Hello, is this {patientFirstName}?") —
// the single highest-risk point in the codebase for a name to leak into a
// log, since the transcript itself contains it.

import { beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createHospital, updateHospitalConfig } from "../lib/db/repositories/hospitals";
import { HospitalConfigSchema } from "../lib/hospitals/config-schema";
import { runCall } from "../lib/voice-intake/run-call";
import { buildPersonaResponder } from "../sim/call-simulator";
import type { TenantContext } from "../lib/db/tenant";
import type { FollowUpQuestion } from "../lib/protocols/schema";
import type { RedFlag } from "../lib/ai/assessors/rule-engine";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false });

const SEED_FIRST_NAME = "Priyaverakshita"; // deliberately distinctive — cannot coincidentally appear in any other log text
const SEED_LAST_NAME = "Thennarasukumar";
const SEED_PHONE = "+91-98765-43210";

const ALWAYS_OPEN_CONFIG = HospitalConfigSchema.parse({
  callingHours: { MON: { start: "00:00", end: "23:59" }, TUE: { start: "00:00", end: "23:59" }, WED: { start: "00:00", end: "23:59" }, THU: { start: "00:00", end: "23:59" }, FRI: { start: "00:00", end: "23:59" }, SAT: { start: "00:00", end: "23:59" }, SUN: { start: "00:00", end: "23:59" } },
  maxConcurrentCalls: 10,
  defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60], jitterPct: 10 },
  defaultFollowUpWindowHours: 168,
  notificationPreferences: { channels: ["IN_APP"], reviewerTimeoutMinutes: 30 },
  ehrSettings: { mode: "mock", failureRate: 0 },
});

const QUESTIONS: FollowUpQuestion[] = [
  { id: "Q1", text: "How is your pain level today?", answerType: "text", probeQuestions: [] },
];
const RED_FLAGS: RedFlag[] = [];

let hospital: { id: string };
let campaignId: string;
const ctx = (): TenantContext => ({ hospitalId: hospital.id, userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" });

beforeAll(async () => {
  hospital = await createHospital({ name: "PHI Redaction Test Hospital", shortCode: `PHI-${Date.now()}`, timezone: "UTC" });
  await updateHospitalConfig(hospital.id, ALWAYS_OPEN_CONFIG);
  const [campaign] = await admin`insert into campaigns (hospital_id, name, state, priority, max_retries) values (${hospital.id}, 'PHI Campaign', 'RUNNING', 1, 3) returning id`;
  campaignId = campaign.id;
});

describe("doc 19 R2 — no PHI in log output", () => {
  it("a real call's log output never contains the seed patient's name or phone number", async () => {
    const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name, phone) values (${hospital.id}, 'PHI-P1', ${SEED_FIRST_NAME}, ${SEED_LAST_NAME}, ${SEED_PHONE}) returning id`;
    const [task] = await admin`insert into outreach_tasks (hospital_id, campaign_id, patient_id, clinical_deadline_at, scheduled_for, max_attempts, risk_level, total_window_hours)
      values (${hospital.id}, ${campaignId}, ${patient.id}, now() + interval '1 day', now(), 3, 'MEDIUM', 24) returning id`;

    const logLines: string[] = [];
    const captureLine = (...args: unknown[]) => logLines.push(args.map(String).join(" "));
    const logSpy = vi.spyOn(console, "log").mockImplementation(captureLine);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(captureLine);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(captureLine);

    try {
      const result = await runCall({
        ctx: ctx(),
        hospitalName: "PHI Redaction Test Hospital",
        patientFirstName: SEED_FIRST_NAME, // embedded directly in the agent's own greeting line
        outreachTaskId: task.id,
        campaignId,
        followUpQuestions: QUESTIONS,
        redFlags: RED_FLAGS,
        patientResponder: buildPersonaResponder("cooperative"),
      });
      expect(result.outcome).toBe("COMPLETED");
      // Sanity check the risk is real: the transcript itself does contain the name —
      // proving this test would actually catch a leak, not just pass vacuously.
      expect(result.transcript.some((t) => t.text.includes(SEED_FIRST_NAME))).toBe(true);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }

    const allOutput = logLines.join("\n");
    expect(allOutput).not.toContain(SEED_FIRST_NAME);
    expect(allOutput).not.toContain(SEED_LAST_NAME);
    expect(allOutput).not.toContain(SEED_PHONE);
    expect(allOutput.length).toBeGreaterThan(0); // sanity: something was actually logged (call.started/call.outcome)
  }, 30000);
});
