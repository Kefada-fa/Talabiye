/**
 * Reads the Supabase settings from .env.local.
 * Throws a clear error if they are missing, instead of failing mysteriously.
 *
 * Note: these must be written out as `process.env.NEXT_PUBLIC_...` exactly,
 * so Next.js can copy the values into the browser code at build time.
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart `npm run dev`.",
    );
  }

  return { url, publishableKey };
}
