// Doc 23 R4 — "the evaluator will break something; let them recover
// without emailing you." A script, not a live in-app button: the app's own
// runtime connection (app_user) deliberately has no DELETE/TRUNCATE grant
// (lib/db/rls.sql) — a real security property from doc 01, not worth
// weakening for a self-service button. This runs against DATABASE_URL (the
// same superuser connection db:migrate/db:rls already use), same as any
// other one-off operator script.
//
// Truncates operational/transactional data (patients, campaigns, calls,
// escalations, etc. — CASCADE handles the rest) and re-seeds a fresh demo
// patient population. Hospitals, users, roles, and protocols are left
// untouched — they're stable configuration, not something a demo session
// corrupts, and re-seeding them needlessly would also invalidate anyone
// already logged in.
//
// Usage: npx tsx scripts/demo-reset.ts   (or npm run demo:reset)

import "dotenv/config";
import postgres from "postgres";
import { execSync } from "node:child_process";

const OPERATIONAL_TABLES = [
  "campaign_state_transitions",
  "eligibility_evaluations",
  "campaigns",
  "outreach_task_state_transitions",
  "outreach_tasks",
  "call_turns",
  "calls",
  "triage_results",
  "escalation_assessments",
  "escalation_state_transitions",
  "escalations",
  "documentation_records",
  "ehr_idempotency_records",
  "events",
  "notifications",
  "idempotency_keys",
  "patients",
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "prefer" });
  console.log(`Truncating ${OPERATIONAL_TABLES.length} operational tables (CASCADE)...`);
  await sql.unsafe(`TRUNCATE TABLE ${OPERATIONAL_TABLES.join(", ")} CASCADE`);
  await sql.end();
  console.log("Truncated. Re-seeding demo patients...");

  execSync("npx tsx sim/generate-patients.ts", { stdio: "inherit" });

  // sim/generate-patients.ts only targets Northside General/Harbour
  // Clinic/Rural Health Post (an earlier iteration's demo hospitals) - it
  // never touches "Demo General Hospital", the one the actual seeded
  // login accounts (hospital-admin@/campaign-manager@/clinical-reviewer@)
  // are scoped to. Without this, a reset silently leaves that hospital
  // empty again.
  execSync("npx tsx scripts/seed-demo-general-hospital.ts", { stdio: "inherit" });

  console.log("\nDemo reset complete. Hospitals, users, and protocols were left untouched.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
