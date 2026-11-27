import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/**
 * Supabase client for code that runs in the BROWSER
 * (files that start with "use client").
 *
 * Usage:
 *   const supabase = createClient();
 */
export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}
