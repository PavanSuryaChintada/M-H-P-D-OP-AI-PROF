import "dotenv/config";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client for route handlers / server components — reads
// the session from request cookies. Uses the publishable (anon) key; RLS on
// Supabase-managed tables (none, in our design — see lib/db/rls.sql) is not
// what protects tenant data here, Postgres RLS via app_user is. This client
// is for Supabase Auth only (who is signed in), not for querying our schema.
export async function createSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY are not set. Copy .env.example to .env.");
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component that can't set cookies (no
          // response to attach them to) — middleware refreshes the session
          // instead. Safe to ignore here.
        }
      },
    },
  });
}
