// Applies lib/db/rls.sql against DATABASE_URL (the superuser connection —
// required, since creating roles and forcing RLS needs elevated privileges).
// The app_user password is never stored in rls.sql itself (that file is
// committed); it's read from DATABASE_URL_POOLED in .env and substituted in
// memory only, right before executing.
//
// Usage: npx tsx scripts/apply-rls.ts

import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

const pooledUrl = process.env.DATABASE_URL_POOLED;
if (!pooledUrl) throw new Error("DATABASE_URL_POOLED is not set — needed to read app_user's password.");

const appUserPassword = new URL(pooledUrl).password;
if (!appUserPassword) {
  throw new Error("Could not extract a password from DATABASE_URL_POOLED.");
}

const sqlPath = join(__dirname, "..", "lib", "db", "rls.sql");
const template = readFileSync(sqlPath, "utf-8");
const statement = template.replace("CHANGE_ME", appUserPassword);

async function main() {
  const sql = postgres(databaseUrl!, { max: 1, ssl: "prefer" });
  try {
    await sql.unsafe(statement);
    console.log("lib/db/rls.sql applied successfully.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
