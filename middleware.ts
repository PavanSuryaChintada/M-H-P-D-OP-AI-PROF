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
    // Skip static assets, image optimization, AND /api/* — every API route
    // already calls supabase.auth.getUser() itself via guard()/
    // resolveTenantContext (lib/auth/session.ts), and unlike a Server
    // Component, a route handler CAN write its own refreshed cookies (see
    // lib/supabase/server.ts's setAll - the try/catch there only exists for
    // the Server Component case). Running this here too meant every single
    // API request paid Supabase's Auth server round trip (measured at
    // ~1.2s) TWICE for no benefit - this middleware's only real job is
    // refreshing the cookie for Server Component pages, which can't do it
    // themselves.
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
