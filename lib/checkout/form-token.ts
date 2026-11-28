import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Spam protection for the checkout form: "filled in under 4 seconds = refuse".
 *
 * The checkout page puts a SIGNED timestamp in the form ("<time>.<signature>").
 * When the form comes back, the server checks the signature (so a bot can't
 * send an old time) and how long ago the page was shown.
 *
 * Secret: CHECKOUT_FORM_SECRET if set, otherwise derived from
 * SUPABASE_SECRET_KEY (both server-only, never NEXT_PUBLIC_).
 */

export const MIN_FILL_MS = 4_000; // faster than this = probably a bot
export const MAX_AGE_MS = 24 * 60 * 60 * 1000; // page older than a day = refresh

function secret(): string | null {
  const own = process.env.CHECKOUT_FORM_SECRET;
  if (own) return own;
  const base = process.env.SUPABASE_SECRET_KEY;
  return base ? createHmac("sha256", base).update("checkout-form-token").digest("hex") : null;
}

function sign(key: string, timestamp: string): string {
  return createHmac("sha256", key).update(timestamp).digest("base64url");
}

/**
 * A fresh token for the checkout page (null if no secret is configured).
 * Reads the clock: only call it in a per-request (dynamic) render.
 */
export function createFormToken(now: number = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const ts = String(now);
  return `${ts}.${sign(key, ts)}`;
}

export type FormTokenCheck = "ok" | "too_fast" | "expired" | "invalid";

export function checkFormToken(token: string | null | undefined, now: number): FormTokenCheck {
  const key = secret();
  if (!key || !token) return "invalid";
  const [ts, sig] = token.split(".");
  if (!ts || !sig || !/^\d{10,16}$/.test(ts)) return "invalid";

  const expected = Buffer.from(sign(key, ts));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";

  const age = now - Number(ts);
  if (age < MIN_FILL_MS) return "too_fast";
  if (age > MAX_AGE_MS) return "expired";
  return "ok";
}
