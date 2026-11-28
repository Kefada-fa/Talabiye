import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (Next.js 16's name for "middleware") — runs before back-office and
 * login pages:
 *   1. Refreshes the Supabase login session, so users stay logged in.
 *   2. Sends logged-out visitors of /dashboard to /login (a quick first
 *      check; every /dashboard page checks again on the server).
 * The storefront doesn't need it, so it's not run there (see `matcher`).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Checks the login (and refreshes it if needed). Don't add code between
  // createServerClient and this call.
  const { data } = await supabase.auth.getClaims();
  const loggedIn = Boolean(data?.claims?.sub);

  if (!loggedIn && request.nextUrl.pathname.startsWith("/dashboard")) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(login);
    // keep any refreshed/cleared auth cookies
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/forgot-password", "/reset-password", "/auth/:path*"],
};
