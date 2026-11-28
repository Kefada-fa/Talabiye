"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  logInAction,
  sendResetLinkAction,
  updatePasswordAction,
  type AuthFormState,
} from "@/lib/auth/actions";
import { t } from "@/lib/i18n";
import { boButtonClass, boInputClass, FormError } from "./auth-card";

const initial: AuthFormState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(logInAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">{t.auth.email}</label>
        <input id="email" name="email" type="email" autoComplete="email" required className={boInputClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">{t.auth.password}</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={boInputClass} />
      </div>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={boButtonClass}>
        {pending ? t.auth.loggingIn : t.auth.logIn}
      </button>
      <Link href="/forgot-password" className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-bo-accent underline-offset-4 hover:underline">
        {t.auth.forgotLink}
      </Link>
    </form>
  );
}

export function ForgotPasswordForm({ linkError }: { linkError: boolean }) {
  const [state, action, pending] = useActionState(sendResetLinkAction, initial);
  if (state.done) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-xl bg-status-paid-bg p-3 text-sm text-status-paid-fg">{t.auth.linkSent}</p>
        <Link href="/login" className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-bo-accent hover:underline">
          {t.auth.backToLogin}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      {linkError && <FormError message={t.auth.errors.badLink} />}
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">{t.auth.email}</label>
        <input id="email" name="email" type="email" autoComplete="email" required className={boInputClass} />
      </div>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={boButtonClass}>
        {pending ? t.auth.sending : t.auth.sendLink}
      </button>
      <Link href="/login" className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-bo-accent hover:underline">
        {t.auth.backToLogin}
      </Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">{t.auth.newPassword}</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className={boInputClass} aria-describedby="password-hint" />
        <p id="password-hint" className="text-xs text-bo-muted">{t.auth.passwordHint}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="confirm" className="text-sm font-medium">{t.auth.confirmPassword}</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required className={boInputClass} />
      </div>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={boButtonClass}>
        {pending ? t.auth.saving : t.auth.savePassword}
      </button>
    </form>
  );
}
