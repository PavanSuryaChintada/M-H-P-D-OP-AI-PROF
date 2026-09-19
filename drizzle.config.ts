import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Only commands that touch the database (migrate, push, studio) need
// DATABASE_URL; `generate` diffs schema.ts against migration snapshots on
// disk and needs no connection, so this falls back to a placeholder rather
// than failing the whole config module.
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
    ssl: "prefer",
  },
  // Supabase's pooled connection (pgbouncer) doesn't support the session-level
  // features drizzle-kit push uses for introspection; migrations should run
  // against the direct (non-pooled) connection string.
  verbose: true,
  strict: true,
});
