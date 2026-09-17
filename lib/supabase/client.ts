import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client — used by a future login page (doc 03+). Safe to
// ship the publishable key to the client; it's designed for that.
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.");
  }
  return createBrowserClient(url, anonKey);
}
