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
// ssl: "prefer", not "require" - CI runs against a plain local Postgres
// container with no TLS support at all, and "require" forces a TLS
// handshake unconditionally, breaking that connection outright ("Client
// network socket disconnected before secure TLS connection was
// established" - every CI run failed on this after the Supabase fix
// first went in). "prefer" negotiates TLS when the server offers it
// (Supabase does, and needs it) and falls back to plaintext when it
// doesn't (CI's local container) - correct against both without an
// environment check.
//
// Pool size is small ONLY on Vercel, and that's deliberate, not
// superstition: this module is re-imported fresh in every serverless
// function instance there, so N concurrent invocations each holding up to
// `max` idle-but-reserved connections can exhaust Supavisor's own upstream
// pool (a small, fixed number on Supabase's free tier) long before actual
// concurrent DB work does — every symptom of that (slow, then 503s, every
// health component UNAVAILABLE, because getSystemHealth's own `select 1`
// couldn't get a connection either) was seen live on the deployed app.
//
// That multiplication risk is specific to "many separate serverless
// instances," not to "one process doing several things at once" — local
// dev, the test suite (which simulates up to 50 concurrent workers to
// prove doc 07's claim-concurrency guarantees, and legitimately needs
// pool headroom for that), and the Railway worker (one long-lived
// process, never multiplied) all get the larger pool that was always
// safe for them. process.env.VERCEL is set to "1" by Vercel's platform
// on every serverless invocation; nothing else in this project's
// deployment sets it.
const isVercel = process.env.VERCEL === "1";
const queryClient = postgres(connectionString, { max: isVercel ? 3 : 10, prepare: false, ssl: "prefer" });

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
