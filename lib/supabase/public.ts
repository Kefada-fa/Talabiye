import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

/**
 * Supabase client for PUBLIC data on the server (the storefront catalog,
 * place_order). No login, no cookies — it acts as a visitor ("anon"), so
 * the database security rules decide what it can see.
 */
export function createPublicClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createSupabaseClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
