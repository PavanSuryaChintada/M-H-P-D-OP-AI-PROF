// Doc 02 deliverable: "Role-switching demo accounts, one per role, seeded."
// Creates one demo hospital and four pre-confirmed Supabase Auth users (one
// per role) with known passwords, for the evaluator to log in as.
//
// Needs SUPABASE_SERVICE_ROLE_KEY (Project Settings → API) — the Admin API
// is what lets us create a user that's already email-confirmed, without
// which a plain signUp() would be stuck behind Supabase's email
// confirmation flow and the evaluator couldn't log in immediately.
//
// Usage: npx tsx scripts/seed-demo-users.ts

import "dotenv/config";
import { createSupabaseAdminClient } from "../lib/supabase/admin";
import { createHospital } from "../lib/db/repositories/hospitals";
import { createUser, findUserByEmail, assignHospitalRole } from "../lib/db/repositories/users";
import type { Role } from "../lib/db/tenant";

const DEMO_PASSWORD = "Demo1234!"; // prototype-only, documented in README — never use for anything real

const DEMO_ACCOUNTS: { email: string; displayName: string; role: Role | "PLATFORM_ADMIN" }[] = [
  { email: "platform-admin@demo.mhpd.local", displayName: "Demo Platform Admin", role: "PLATFORM_ADMIN" },
  { email: "hospital-admin@demo.mhpd.local", displayName: "Demo Hospital Admin", role: "HOSPITAL_ADMIN" },
  { email: "campaign-manager@demo.mhpd.local", displayName: "Demo Campaign Manager", role: "CAMPAIGN_MANAGER" },
  { email: "clinical-reviewer@demo.mhpd.local", displayName: "Demo Clinical Reviewer", role: "CLINICAL_REVIEWER" },
];

async function main() {
  const admin = createSupabaseAdminClient();

  const hospital = await createHospital({
    name: "Demo General Hospital",
    shortCode: "DEMO",
    timezone: "Asia/Kolkata",
  });
  console.log(`Seeded hospital: ${hospital.name} (${hospital.id})`);

  for (const account of DEMO_ACCOUNTS) {
    let appUser = await findUserByEmail(account.email);

    if (!appUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email: account.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`Failed to create Supabase Auth user ${account.email}: ${error?.message}`);
      }

      appUser = await createUser({
        email: account.email,
        displayName: account.displayName,
        authProviderId: data.user.id,
        isPlatformAdmin: account.role === "PLATFORM_ADMIN",
      });
      console.log(`Created ${account.role}: ${account.email}`);
    } else {
      console.log(`Already exists, skipping: ${account.email}`);
    }

    if (account.role !== "PLATFORM_ADMIN") {
      await assignHospitalRole({ userId: appUser.id, hospitalId: hospital.id, role: account.role });
    }
  }

  console.log("\nDemo credentials (password for all): " + DEMO_PASSWORD);
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role.padEnd(17)} ${a.email}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
