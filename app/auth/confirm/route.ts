import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Where links in Supabase auth emails land (e.g. "reset your password").
 * Turns the one-time code from the email into a login session, then goes
 * on to `next` (e.g. /reset-password).
 *
 * Works with both kinds of Supabase email links:
 *   ?code=…                      (default template)
 *   ?token_hash=…&type=recovery  (custom template)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  let ok = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  }

  const target = request.nextUrl.clone();
  target.search = "";
  if (ok) {
    target.pathname = next;
  } else {
    target.pathname = "/forgot-password";
    target.searchParams.set("error", "link");
  }
  return NextResponse.redirect(target);
}
