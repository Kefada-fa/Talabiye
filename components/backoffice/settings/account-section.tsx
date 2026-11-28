"use client";

import { useState, useTransition } from "react";
import { changePasswordAction } from "@/app/dashboard/settings/actions";
import { t } from "@/lib/i18n";
import { validatePasswordChange, type FieldErrors } from "@/lib/settings/validate";
import { inputClass, primaryButton } from "./kit";

const a = t.backoffice.settings.account;

/**
 * "My account": for EVERY member (staff too), so it's not inside the
 * read-only settings fieldset.
 */
export function AccountSection({ email }: { email: string | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    setError(null);
    const local = validatePasswordChange({ current, next, repeat }).errors;
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    startTransition(async () => {
      const res = await changePasswordAction({ current, next, repeat });
      if (res.ok) {
        setDone(true);
        setCurrent("");
        setNext("");
        setRepeat("");
      } else {
        setErrors(res.fieldErrors ?? {});
        setError(res.error ?? null);
      }
    });
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string, hint?: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <input
        id={id}
        type="password"
        autoComplete={auto}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={inputClass}
        aria-invalid={!!errors[id]}
        aria-describedby={errors[id] ? `${id}-error` : undefined}
      />
      {errors[id] ? (
        <p id={`${id}-error`} className="text-sm font-medium text-status-refused-fg">{errors[id]}</p>
      ) : (
        hint && <p className="text-sm text-bo-muted">{hint}</p>
      )}
    </div>
  );

  return (
    <section id="account" aria-labelledby="account-title" className="scroll-mt-24 rounded-bo-card border border-bo-border bg-bo-card p-5 md:scroll-mt-6 md:p-6">
      <h2 id="account-title" className="font-bo-heading text-xl font-semibold">{a.title}</h2>
      <p className="mt-1 text-sm text-bo-muted">{a.intro}</p>

      <dl className="mt-5 flex flex-col gap-1">
        <dt className="text-sm font-semibold">{a.email}</dt>
        <dd className="text-base">{email ?? "—"}</dd>
      </dl>

      <form onSubmit={submit} noValidate className="mt-6 flex max-w-md flex-col gap-4">
        <h3 className="font-bo-heading text-lg font-semibold">{a.changePassword}</h3>
        {/* Hidden username helps password managers. */}
        <input type="email" autoComplete="username" value={email ?? ""} readOnly hidden />
        {field("current", a.current, current, setCurrent, "current-password")}
        {field("next", a.new, next, setNext, "new-password", a.hint)}
        {field("repeat", a.repeat, repeat, setRepeat, "new-password")}
        {error && <p role="alert" className="rounded-xl bg-status-refused-bg p-3 text-sm text-status-refused-fg">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryButton} disabled={pending}>
            {pending ? t.backoffice.settings.saving : a.save}
          </button>
          <span role="status" aria-live="polite" className="text-sm font-semibold text-status-paid-fg">{done ? a.done : ""}</span>
        </div>
      </form>
    </section>
  );
}
