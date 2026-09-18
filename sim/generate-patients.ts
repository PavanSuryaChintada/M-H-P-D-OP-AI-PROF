// Doc 04 R1/R2 deliverable — deterministic (seeded RNG) demo patient
// generator. Writes through the same lib/discharge/ingest.ts pipeline the
// HTTP batch endpoint uses, called directly rather than over HTTP: seeding
// ~450 patients one HTTP round trip at a time is not what the batch
// endpoint is for.
//
// Usage: npx tsx sim/generate-patients.ts [--seed 42] [--count 450]

import "dotenv/config";
import { createRng } from "./rng";
import { listHospitals } from "../lib/db/repositories/hospitals";
import { findUserByEmail } from "../lib/db/repositories/users";
import { ingestDischargeRecord } from "../lib/discharge/ingest";
import type { DischargeRecord } from "../lib/discharge/schema";
import type { TenantContext } from "../lib/db/tenant";

const FIRST_NAMES = ["James", "Mary", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer", "William", "Elizabeth", "Ahmed", "Fatima", "Wei", "Priya", "Carlos", "Sofia", "Erik", "Ingrid"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Andersson", "Lindqvist", "Khan", "Patel", "Chen", "Nguyen", "Rossi", "Kowalski"];

const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const RISK_WEIGHTS = [50, 30, 15, 5];
const FOLLOW_UP_WINDOWS = [24, 48, 72, 168]; // hours: 24h, 48h, 72h, 7d

const CONDITIONS_BY_RISK: Record<(typeof RISK_LEVELS)[number], string[]> = {
  LOW: ["Hypertension, well-controlled", "Osteoarthritis"],
  MEDIUM: ["Type 2 Diabetes Mellitus", "COPD exacerbation"],
  HIGH: ["Congestive Heart Failure", "Post-myocardial infarction"],
  CRITICAL: ["Sepsis, resolving", "Acute kidney injury"],
};
// A second category per risk level, used to make "dual campaign candidate"
// patients have two condition types a future eligibility rule could match
// on independently (doc 05).
const SECONDARY_CONDITIONS = ["Chronic kidney disease, stage 3", "Depression", "Chronic pain syndrome"];

const MEDICATIONS = ["Lisinopril 10mg", "Metformin 500mg", "Furosemide 20mg", "Atorvastatin 40mg", "Albuterol inhaler"];

interface HospitalTarget {
  hospitalId: string;
  shortCode: string;
  actorUserId: string;
  count: number;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: number) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) : fallback;
  };
  return { seed: get("--seed", 42), count: get("--count", 450) };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Runs `worker` over `items` with at most `concurrency` in flight — the pooled db client (max: 10 connections) is the ceiling. */
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

function generateRecord(rng: ReturnType<typeof createRng>, shortCode: string, seq: number, now: Date): DischargeRecord {
  const riskLevel = rng.pick(RISK_LEVELS, RISK_WEIGHTS);
  const followUpWindowHours = rng.pick(FOLLOW_UP_WINDOWS);

  // R2 — discharge times spread across the last 72h, including some with
  // under 2h left in their follow-up window (dischargeAt + window ≈ now).
  const nearDeadline = rng.chance(0.1);
  const hoursAgo = nearDeadline
    ? followUpWindowHours - rng.int(0, 2) // 0-2h remaining
    : rng.int(0, 72);
  const dischargeAt = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

  const invalidNumber = rng.chance(0.08);
  const dualCampaignCandidate = rng.chance(0.02); // "a handful" across ~450
  // R2 also asks for ~12% who will request callbacks and ~15% who will
  // present protocol red flags "in conversation" — that's scripted call
  // *behavior*, not discharge data. It has nowhere to live yet: the call
  // simulator (doc 10) doesn't exist, and whether it belongs on the patient
  // or on a specific outreach_task is doc 10's call to make. Not faking a
  // field for it here.

  const firstName = rng.pick(FIRST_NAMES);
  const lastName = rng.pick(LAST_NAMES);
  const mrn = `${shortCode}-${pad(seq, 5)}`;

  const conditions = [{ codeText: rng.pick(CONDITIONS_BY_RISK[riskLevel]) }];
  if (dualCampaignCandidate) {
    conditions.push({ codeText: rng.pick(SECONDARY_CONDITIONS) });
  }

  const record: DischargeRecord = {
    sourceMessageId: `${shortCode}-DISCH-${pad(seq, 5)}`,
    patient: {
      mrn,
      firstName,
      lastName,
      phone: invalidNumber ? "000-000-0000" : `+1555${pad(rng.int(0, 9999999), 7)}`,
      email: rng.chance(0.9) ? `${firstName}.${lastName}${seq}@example.test`.toLowerCase() : undefined,
      preferredLanguage: rng.pick(["en", "en", "en", "es", "hi", "sv"]),
      communicationPreferences: rng.chance(0.3)
        ? { noCallsBefore: "10:00" }
        : undefined,
    },
    encounter: {
      careSetting: rng.pick(["Inpatient", "Emergency", "Observation"]),
      dischargeAt: dischargeAt.toISOString(),
      dischargeInstructions: "Follow up with primary care within the specified window. Monitor symptoms and seek care if they worsen.",
    },
    riskLevel,
    followUpWindowHours,
    conditions,
    observations: [],
    medications: rng.chance(0.7) ? [{ name: rng.pick(MEDICATIONS) }] : [],
  };

  return record;
}

async function main() {
  const { seed, count } = parseArgs();
  const rng = createRng(seed);
  const now = new Date();

  const hospitals = await listHospitals();
  const byShortCode = new Map(hospitals.map((h) => [h.shortCode, h]));

  // R1 — weighted so the lowest-capacity hospital still has ~80 patients;
  // proportional-to-capacity would give it almost none, which is the
  // opposite of what makes the queue demo's concurrency visible.
  const weights: Record<string, number> = { NSG: 0.44, HBC: 0.36, RHP: 0.2 };
  const targets: HospitalTarget[] = [];
  for (const [shortCode, weight] of Object.entries(weights)) {
    const hospital = byShortCode.get(shortCode);
    if (!hospital) {
      console.warn(`Hospital ${shortCode} not found — run seed-demo-hospitals.ts first. Skipping.`);
      continue;
    }
    const adminEmail = {
      NSG: "admin@northside.demo.mhpd.local",
      HBC: "admin@harbour.demo.mhpd.local",
      RHP: "admin@ruralhealthpost.demo.mhpd.local",
    }[shortCode]!;
    const admin = await findUserByEmail(adminEmail);
    if (!admin) {
      console.warn(`Admin user ${adminEmail} not found — run seed-demo-hospitals.ts first. Skipping ${shortCode}.`);
      continue;
    }
    targets.push({
      hospitalId: hospital.id,
      shortCode,
      actorUserId: admin.id,
      count: Math.round(count * weight),
    });
  }

  let totalCreated = 0;
  for (const target of targets) {
    const ctx: TenantContext = { hospitalId: target.hospitalId, userId: target.actorUserId, role: "HOSPITAL_ADMIN" };

    // Generation must stay a single sequential loop — it's what consumes
    // the shared rng, and the seed only reproduces the same dataset if
    // records are drawn from it in a fixed order. Ingestion (I/O, no rng
    // involved) is what's safe to parallelize.
    const records = Array.from({ length: target.count }, (_, i) => generateRecord(rng, target.shortCode, i + 1, now));

    let created = 0;
    await runWithConcurrency(records, 10, async (record) => {
      const result = await ingestDischargeRecord(ctx, record);
      if (result.status === "created") created++;
    });
    totalCreated += created;
    console.log(`${target.shortCode}: ${target.count} discharge records processed (${created} new)`);
  }

  console.log(`\nDone. ${totalCreated} new patients created across ${targets.length} hospitals (seed=${seed}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
