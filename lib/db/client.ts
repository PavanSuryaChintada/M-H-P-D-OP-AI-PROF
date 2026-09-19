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
//
// Supabase's pooler rejects app_user connections outright with
// "(ESSLREQUIRED) SSL connection is required" unless TLS is requested
// explicitly - postgres.js defaults to no SSL, and neither
// DATABASE_URL_POOLED nor DATABASE_URL carries a `?sslmode=` query param
// that would tell it to negotiate TLS on its own.
//
// max: 3, not 10 — this module is re-imported fresh in every serverless
// function instance on Vercel. A pool of 10 made sense for one long-lived
// worker process; on Vercel, N concurrent invocations each holding up to
// 10 idle-but-reserved connections can exhaust Supavisor's own upstream
// pool (a small, fixed number on Supabase's free tier) long before actual
// concurrent DB work does — every symptom of that (slow, then 503s, every
// health component UNAVAILABLE, because getSystemHealth's own `select 1`
// can't get a connection either) was seen live on the deployed app. 3 is
// a compromise, not a superstition: 1 starved getSystemHealth's own
// Promise.all fan-out across hospitals (measured — it serialized 31
// hospitals onto a single connection and took minutes instead of
// seconds); 3 gives that real, already-existing concurrency need some
// room while staying far below the old per-instance ceiling of 10.
const queryClient = postgres(connectionString, { max: 3, prepare: false, ssl: "require" });

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
