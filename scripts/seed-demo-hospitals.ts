// Doc 03 deliverable: "Seeded demo hospitals: at least 3, different
// timezones, different capacity ... the low-capacity one makes the queue
// demo vivid." Exact 3 from doc 03's own Claude Code prompt.
//
// Each hospital gets full operating config + one HOSPITAL_ADMIN + one
// escalation contact, but is left at CONFIGURED, not READY — readiness
// also requires ≥1 protocol (doc 11), which doesn't exist yet. Faking a
// protocol row here just to flip a status flag would misrepresent what's
// actually been built; the readiness checklist will correctly report
// "at least one protocol" as the one remaining gap until doc 11 lands.
//
// Usage: npx tsx scripts/seed-demo-hospitals.ts

import "dotenv/config";
import { createSupabaseAdminClient } from "../lib/supabase/admin";
import { createHospital, updateHospitalConfig, updateHospitalStatus } from "../lib/db/repositories/hospitals";
import { createUser, findUserByEmail, assignHospitalRole } from "../lib/db/repositories/users";
import { addEscalationContact } from "../lib/db/repositories/escalation-contacts";
import { upsertHospitalCapacity } from "../lib/db/repositories/hospital-capacity";
import { HospitalConfigSchema, type HospitalConfig } from "../lib/hospitals/config-schema";
import type { TenantContext } from "../lib/db/tenant";

const DEMO_PASSWORD = "Demo1234!";

const dailyHours = (start: string, end: string) => ({
  MON: { start, end }, TUE: { start, end }, WED: { start, end }, THU: { start, end }, FRI: { start, end },
});

const HOSPITALS: {
  name: string;
  shortCode: string;
  timezone: string;
  maxConcurrentCalls: number;
  adminEmail: string;
}[] = [
  {
    name: "Northside General",
    shortCode: "NSG",
    timezone: "America/New_York",
    maxConcurrentCalls: 10,
    adminEmail: "admin@northside.demo.mhpd.local",
  },
  {
    name: "Harbour Clinic",
    shortCode: "HBC",
    timezone: "Europe/Stockholm",
    maxConcurrentCalls: 3,
    adminEmail: "admin@harbour.demo.mhpd.local",
  },
  {
    name: "Rural Health Post",
    shortCode: "RHP",
    timezone: "Asia/Kolkata",
    maxConcurrentCalls: 1,
    adminEmail: "admin@ruralhealthpost.demo.mhpd.local",
  },
];

function buildConfig(maxConcurrentCalls: number): HospitalConfig {
  const config = {
    callingHours: dailyHours("09:00", "18:00"),
    maxConcurrentCalls,
    defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60, 240], jitterPct: 10 },
    defaultFollowUpWindowHours: 72,
    notificationPreferences: {
      channels: ["IN_APP", "EMAIL"] as const,
      reviewerTimeoutMinutes: 30,
    },
    ehrSettings: { mode: "mock" as const, failureRate: 0.05 },
  };
  return HospitalConfigSchema.parse(config);
}

async function main() {
  const admin = createSupabaseAdminClient();

  for (const h of HOSPITALS) {
    const hospital = await createHospital({ name: h.name, shortCode: h.shortCode, timezone: h.timezone });
    console.log(`Created hospital: ${h.name} (${hospital.id}, ${h.timezone}, capacity ${h.maxConcurrentCalls})`);

    const config = buildConfig(h.maxConcurrentCalls);
    await updateHospitalConfig(hospital.id, config);

    let adminUser = await findUserByEmail(h.adminEmail);
    if (!adminUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email: h.adminEmail,
        password: DEMO_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`Failed to create auth user ${h.adminEmail}: ${error?.message}`);
      adminUser = await createUser({
        email: h.adminEmail,
        displayName: `${h.name} Admin`,
        authProviderId: data.user.id,
      });
    }
    await assignHospitalRole({ userId: adminUser.id, hospitalId: hospital.id, role: "HOSPITAL_ADMIN" });

    const ctx: TenantContext = { hospitalId: hospital.id, userId: adminUser.id, role: "HOSPITAL_ADMIN" };
    await upsertHospitalCapacity(ctx, h.maxConcurrentCalls);
    await addEscalationContact(ctx, {
      orderIndex: 0,
      role: "Charge Nurse",
      channel: "EMAIL",
      contactValue: h.adminEmail,
      ackTimeoutMinutes: 15,
    });

    await updateHospitalStatus(hospital.id, "CONFIGURED");
    console.log(`  admin: ${h.adminEmail} / ${DEMO_PASSWORD}`);
  }

  console.log("\nAll 3 hospitals are CONFIGURED, not READY — each is missing a protocol (doc 11).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
