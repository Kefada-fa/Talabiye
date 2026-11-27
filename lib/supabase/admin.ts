import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * ⚠️ ADMIN Supabase client — bypasses Row Level Security.
 *
 * Only for trusted server code that must read private tables (e.g. the
 * notification sender reading the outbox). NEVER import this from a
 * "use client" file, and never use it to answer a visitor's request with
 * data they shouldn't see. The "server-only" import above makes the build
 * fail if it's ever pulled into browser code.
 *
 * Uses SUPABASE_SECRET_KEY (server-only, never NEXT_PUBLIC_).
 * Returns null when the key isn't set, so callers can skip gracefully.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return null;

  return createSupabaseClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
