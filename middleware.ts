import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session cookie on every request. Without this,
// Server Components (which can't write cookies themselves — see
// lib/supabase/server.ts) would see an expired session even when a valid
// refresh token exists, since nothing else in the request path writes the
// refreshed tokens back. Standard Supabase SSR pattern for Next.js.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching getUser() is what triggers the refresh-if-needed + cookie write.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Skip static assets and image optimization; run on everything else
    // (in particular, every /api/* route).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
