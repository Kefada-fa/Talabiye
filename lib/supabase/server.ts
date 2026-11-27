import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

/**
 * Supabase client for code that runs on the SERVER
 * (server components, server actions, route handlers).
 *
 * Create a new one for each request — don't share it between requests.
 *
 * Usage:
 *   const supabase = await createClient();
 */
export async function createClient() {
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
          // Server components can't write cookies — that's OK.
          // Session refresh will be handled by the proxy once we add login.
        }
      },
    },
  });
}
