"use server";

import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { appUrl, safeNextPath } from "./redirect";

export type AuthFormState = { error: string | null; done?: boolean };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Supabase auth errors → friendly messages (never reveal which part was wrong). */
function friendly(error: { code?: string; status?: number; message?: string }): string {
  const code = error.code ?? "";
  if (code === "invalid_credentials") return t.auth.errors.wrongLogin;
  if (code === "email_not_confirmed") return t.auth.errors.emailNotConfirmed;
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || error.status === 429) {
    return t.auth.errors.tooMany;
  }
  if (code === "same_password") return t.auth.errors.samePassword;
  if (code === "weak_password") return t.auth.errors.passwordShort;
  console.error("[auth]", error);
  return t.auth.errors.generic;
}

/** Email + password login. */
export async function logInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = text(formData, "email");
  const password = typeof formData.get("password") === "string" ? (formData.get("password") as string) : "";
  if (!email || !password) return { error: t.auth.errors.missing };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendly(error) };

  redirect(safeNextPath(text(formData, "next")));
}

/** Sends a "choose a new password" email. Always answers the same way. */
export async function sendResetLinkAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = text(formData, "email");
  if (!EMAIL_RE.test(email)) return { error: t.auth.errors.email };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl()}/auth/confirm?next=/reset-password`,
  });
  // Don't tell anyone whether the email exists — only report rate limits.
  if (error && (error.status === 429 || error.code?.startsWith("over_"))) {
    return { error: t.auth.errors.tooMany };
  }
  if (error) console.error("[auth] reset link:", error);
  return { error: null, done: true };
}

/** Saves the new password (the reset link logged the user in). */
export async function updatePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = typeof formData.get("password") === "string" ? (formData.get("password") as string) : "";
  const confirm = typeof formData.get("confirm") === "string" ? (formData.get("confirm") as string) : "";
  if (password.length < 8) return { error: t.auth.errors.passwordShort };
  if (password !== confirm) return { error: t.auth.errors.passwordMismatch };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { error: t.auth.errors.badLink };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: friendly(error) };

  redirect("/dashboard");
}

/** Logs out and goes back to the login page. */
export async function logOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
