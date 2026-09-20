// Fixes a real gap found during demo prep: "Demo General Hospital" (the one
// hospital the seeded HOSPITAL_ADMIN/CAMPAIGN_MANAGER/CLINICAL_REVIEWER demo
// accounts are actually scoped to) was created but never configured or
// populated — no hospital_capacity row (the queue can't claim/call anything
// without one), no operating config (calling hours/retry policy), status
// still CREATED, and zero patients/campaigns. scripts/seed-demo-hospitals.ts
// exists but targets three DIFFERENT demo hospitals (Northside General /
// Harbour Clinic / Rural Health Post) from an earlier iteration of this
// build, not the one the login accounts point at.
//
// This does the minimum to make every demo portal show real, live data:
// configure the hospital, seed a batch of patients through the real
// ingestion pipeline, and start one campaign so the (already-deployed)
// worker begins claiming and calling them on its own within its next few
// ticks — the queue, calls, and escalations that follow are genuinely
// produced by the running system, not additionally faked here.
//
// Usage: npx tsx scripts/seed-demo-general-hospital.ts

import "dotenv/config";
import { updateHospitalConfig, updateHospitalStatus } from "../lib/db/repositories/hospitals";
import { db } from "../lib/db/client";
import { hospitals } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { findUserByEmail } from "../lib/db/repositories/users";
import { upsertHospitalCapacity } from "../lib/db/repositories/hospital-capacity";
import { addEscalationContact } from "../lib/db/repositories/escalation-contacts";
import { createCampaign, listCampaigns } from "../lib/db/repositories/campaigns";
import { transitionCampaign } from "../lib/campaigns/transition";
import { ingestDischargeRecord } from "../lib/discharge/ingest";
import { HospitalConfigSchema, type HospitalConfig } from "../lib/hospitals/config-schema";
import type { DischargeRecord } from "../lib/discharge/schema";
import type { TenantContext } from "../lib/db/tenant";
import { createRng } from "../sim/rng";

const PATIENT_COUNT = 24;

const FIRST_NAMES = ["James", "Mary", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer", "Ahmed", "Fatima", "Wei", "Priya", "Carlos", "Sofia"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Garcia", "Miller", "Davis", "Khan", "Patel", "Chen", "Nguyen", "Rossi"];
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const RISK_WEIGHTS = [40, 30, 20, 10];
const CONDITIONS_BY_RISK: Record<(typeof RISK_LEVELS)[number], string[]> = {
  LOW: ["Hypertension, well-controlled", "Osteoarthritis"],
  MEDIUM: ["Type 2 Diabetes Mellitus", "COPD exacerbation"],
  HIGH: ["Congestive Heart Failure", "Post-myocardial infarction"],
  CRITICAL: ["Sepsis, resolving", "Acute kidney injury"],
};
const MEDICATIONS = ["Lisinopril 10mg", "Metformin 500mg", "Furosemide 20mg", "Atorvastatin 40mg"];

function pad(n: number, width: number) {
  return String(n).padStart(width, "0");
}

function generateRecord(rng: ReturnType<typeof createRng>, seq: number, now: Date, runTag: string): DischargeRecord {
  const riskLevel = rng.pick(RISK_LEVELS, RISK_WEIGHTS);
  const firstName = rng.pick(FIRST_NAMES);
  const lastName = rng.pick(LAST_NAMES);
  const hoursAgo = rng.int(0, 48);
  return {
    // runTag makes every run's records genuinely new (sourceMessageId is
    // the idempotency key - a fixed one meant a second run of this script
    // just re-confirmed the same 24 patients, 0 new, which is useless the
    // day before a demo when you want a fresh, still-PENDING queue to show
    // moving on camera instead of one the worker already fully drained.
    sourceMessageId: `DEMO-DISCH-${runTag}-${pad(seq, 4)}`,
    patient: {
      mrn: `DEMO-${runTag}-${pad(seq, 5)}`,
      firstName,
      lastName,
      phone: `+1555${pad(rng.int(0, 9999999), 7)}`,
      email: `${firstName}.${lastName}${seq}@example.test`.toLowerCase(),
      preferredLanguage: "en",
    },
    encounter: {
      careSetting: rng.pick(["Inpatient", "Emergency", "Observation"]),
      dischargeAt: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString(),
      dischargeInstructions: "Follow up with primary care within the specified window. Monitor symptoms and seek care if they worsen.",
    },
    riskLevel,
    followUpWindowHours: 72,
    conditions: [{ codeText: rng.pick(CONDITIONS_BY_RISK[riskLevel]) }],
    observations: [],
    medications: rng.chance(0.7) ? [{ name: rng.pick(MEDICATIONS) }] : [],
  };
}

function buildConfig(reviewerUserId: string | undefined): HospitalConfig {
  const allWeek = { start: "00:00", end: "23:59" };
  return HospitalConfigSchema.parse({
    callingHours: { MON: allWeek, TUE: allWeek, WED: allWeek, THU: allWeek, FRI: allWeek, SAT: allWeek, SUN: allWeek },
    maxConcurrentCalls: 10,
    defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60, 240], jitterPct: 10 },
    defaultFollowUpWindowHours: 72,
    notificationPreferences: {
      channels: ["IN_APP"],
      reviewerTimeoutMinutes: 30,
      ...(reviewerUserId ? { backupReviewerUserId: reviewerUserId } : {}),
    },
    ehrSettings: { mode: "mock", failureRate: 0.05 },
  });
}

async function main() {
  const [hospital] = await db.select().from(hospitals).where(eq(hospitals.name, "Demo General Hospital"));
  if (!hospital) throw new Error('"Demo General Hospital" not found — run npm run seed:demo-users first.');
  console.log(`Configuring ${hospital.name} (${hospital.id})`);

  const hospitalAdmin = await findUserByEmail("hospital-admin@demo.mhpd.local");
  const clinicalReviewer = await findUserByEmail("clinical-reviewer@demo.mhpd.local");
  if (!hospitalAdmin) throw new Error("hospital-admin@demo.mhpd.local not found — run npm run seed:demo-users first.");

  const ctx: TenantContext = { hospitalId: hospital.id, userId: hospitalAdmin.id, role: "HOSPITAL_ADMIN" };

  await updateHospitalConfig(hospital.id, buildConfig(clinicalReviewer?.id));
  await upsertHospitalCapacity(ctx, 10);
  if (clinicalReviewer) {
    await addEscalationContact(ctx, {
      orderIndex: 0,
      role: "Clinical Reviewer",
      channel: "IN_APP",
      contactValue: clinicalReviewer.email,
      ackTimeoutMinutes: 15,
    }).catch(() => {}); // fine if this has already been seeded before
  }
  await updateHospitalStatus(hospital.id, "READY");
  console.log("  config, capacity, escalation contact, status=READY done.");

  const runTag = Date.now().toString(36).toUpperCase().slice(-6);
  const rng = createRng(Date.now());
  const now = new Date();
  const records = Array.from({ length: PATIENT_COUNT }, (_, i) => generateRecord(rng, i + 1, now, runTag));
  let created = 0;
  for (const record of records) {
    const result = await ingestDischargeRecord(ctx, record);
    if (result.status === "created") created++;
  }
  console.log(`  ${created} new patients ingested (run tag ${runTag}, of ${PATIENT_COUNT} discharge records processed).`);

  // Reuse the existing demo campaign rather than creating a new one every
  // run (which would leave several RUNNING campaigns all competing for the
  // same capacity, confusing on camera). Pausing then resuming an already-
  // RUNNING campaign forces the same eligibility recompute + materialize
  // that RUNNING normally does on creation, so the freshly-ingested
  // patients above actually get queued - see doc 05 R4, "resume
  // recomputes eligibility rather than replaying the old task list."
  const existing = await listCampaigns(ctx);
  const CAMPAIGN_NAME = "Demo post-discharge follow-up";
  let campaign = existing.find((c) => c.name === CAMPAIGN_NAME);

  if (!campaign) {
    campaign = await createCampaign(ctx, {
      name: CAMPAIGN_NAME,
      description: "Seeded for the demo - eligibility criteria intentionally empty (matches every risk level/condition).",
      eligibilityCriteria: {},
      followUpWindowHours: 72,
    });
    await transitionCampaign(ctx, campaign.id, "READY", "seed script");
    await transitionCampaign(ctx, campaign.id, "RUNNING", "seed script");
    console.log(`  campaign "${campaign.name}" created and RUNNING (${campaign.id}).`);
  } else if (campaign.state === "RUNNING") {
    await transitionCampaign(ctx, campaign.id, "PAUSED", "seed script re-run: recompute eligibility for new patients");
    await transitionCampaign(ctx, campaign.id, "RUNNING", "seed script re-run: recompute eligibility for new patients");
    console.log(`  campaign "${campaign.name}" already existed - paused/resumed to pick up the new patients (${campaign.id}).`);
  } else {
    await transitionCampaign(ctx, campaign.id, "RUNNING", "seed script re-run");
    console.log(`  campaign "${campaign.name}" already existed in state ${campaign.state} - transitioned to RUNNING (${campaign.id}).`);
  }

  console.log("\nDone. The worker will start claiming and calling these patients within its next few ticks.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
