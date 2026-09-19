import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL (or DATABASE_URL_POOLED) is not set. Copy .env.example to .env.");
}

// One shared pool for the process. Transactions opened through withTenant()
// (see tenant.ts) each borrow a single connection for their lifetime so the
// per-transaction RLS GUCs (set_config) never leak across concurrent callers.
//
// prepare: false — Supabase's Supavisor pooler in transaction mode (the
// DATABASE_URL_POOLED default, port 6543) doesn't support server-side
// prepared statements, since a pooled connection can be handed to a
// different client between statements. Safe to disable unconditionally,
// including against a direct/session-mode connection.
// Supabase's pooler rejects app_user connections outright with
// "(ESSLREQUIRED) SSL connection is required" unless TLS is requested
// explicitly - postgres.js defaults to no SSL, and neither
// DATABASE_URL_POOLED nor DATABASE_URL carries a `?sslmode=` query param
// that would tell it to negotiate TLS on its own.
const queryClient = postgres(connectionString, { max: 10, prepare: false, ssl: "require" });

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
