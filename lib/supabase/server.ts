import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getSupabaseEnv } from "./env";

/**
 * Supabase client for code that runs on the SERVER, as the logged-in user
 * (server components, server actions, route handlers).
 *
 * Create a new one for each request — don't share it between requests.
 *
 * Usage:
 *   const supabase = await createClient();
 */
export async function createClient() {
  // Always per request: the login check reads the clock (is the session
  // expired?), which Next.js doesn't allow while pre-building pages.
  await connection();

  const { url, publishableKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server components can't write cookies — that's OK:
          // proxy.ts refreshes the session before the page renders.
        }
      },
    },
  });
}
