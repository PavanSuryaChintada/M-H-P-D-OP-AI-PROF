import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client — bypasses Auth's normal signup flow (email
// confirmation, rate limits) to create pre-confirmed accounts. Used ONLY by
// scripts/seed-demo-users.ts, never imported from application/route-handler
// code. Throws instead of silently falling back, so a missing service key
// fails loudly at the one place that needs it.
export function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. Get the service role " +
        "(or new-style secret) key from Supabase dashboard → Project Settings → API.",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
