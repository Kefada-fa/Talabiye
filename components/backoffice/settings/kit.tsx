"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { fill, t } from "@/lib/i18n";
import type { SaveResult } from "@/lib/settings/types";
import type { FieldErrors } from "@/lib/settings/validate";

const s = t.backoffice.settings;

export const inputClass =
  "min-h-11 w-full rounded-xl border border-bo-border bg-white px-4 py-2.5 text-base text-bo-ink outline-none focus:border-bo-accent focus:ring-2 focus:ring-bo-accent/25 disabled:bg-bo-page disabled:text-bo-muted aria-[invalid=true]:border-status-refused-fg";
export const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-bo-accent px-5 text-base font-semibold text-white transition-colors hover:bg-bo-accent-hover disabled:opacity-60";
export const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-bo-border bg-white px-4 text-sm font-semibold text-bo-ink transition-colors hover:bg-bo-page disabled:opacity-60";
export const dangerButton =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-status-refused-fg/30 bg-white px-4 text-sm font-semibold text-status-refused-fg transition-colors hover:bg-status-refused-bg disabled:opacity-60";

// ------------------------------------------------------------------ dirty
// Every card tells this registry whether it has unsaved edits, so the page
// can warn before leaving.
type DirtyRegistry = { set: (id: string, dirty: boolean) => void; readOnly: boolean };
const DirtyContext = createContext<DirtyRegistry>({ set: () => {}, readOnly: false });

export function SettingsProvider({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  const dirty = useRef(new Set<string>());

  const set = useCallback((id: string, isDirty: boolean) => {
    if (isDirty) dirty.current.add(id);
    else dirty.current.delete(id);
  }, []);

  useEffect(() => {
    // Closing the tab / reloading.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current.size > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    // Clicking a link inside the app (menu, tabs…). Runs before Next.js
    // handles the click (capture phase), so we can stop it.
    const onClick = (e: MouseEvent) => {
      if (dirty.current.size === 0 || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab: nothing is lost
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) return; // section menu on this page
      if (!window.confirm(s.leaveWarning)) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        dirty.current.clear();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  const value = useMemo(() => ({ set, readOnly }), [set, readOnly]);
  return <DirtyContext.Provider value={value}>{children}</DirtyContext.Provider>;
}

export const useReadOnly = () => useContext(DirtyContext).readOnly;

// --------------------------------------------------------------- section
/**
 * State of one settings card: current values, saved values (to know if
 * something changed), field errors and the save call.
 */
export function useSection<T>(initial: T) {
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  const update = useCallback(<K extends keyof T>(key: K, v: T[K]) => {
    setValue((old) => ({ ...old, [key]: v }));
    setSavedAt(0);
  }, []);

  /** check: browser-side validation (same rules as the server). */
  const save = (action: (v: T) => Promise<SaveResult>, check?: (v: T) => FieldErrors) => {
    const local = check?.(value) ?? {};
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setError(local.form ?? s.errors.fixFields);
      return;
    }
    setError(null);
    const snapshot = value;
    startTransition(async () => {
      try {
        const res = await action(snapshot);
        if (res.ok) {
          setSaved(snapshot);
          const at = Date.now();
          setSavedAt(at);
          // "Saved ✓" disappears after a few seconds.
          window.setTimeout(() => setSavedAt((cur) => (cur === at ? 0 : cur)), 3000);
        } else {
          setErrors(res.fieldErrors ?? {});
          setError(res.error ?? s.errors.fixFields);
        }
      } catch {
        setError(s.errors.generic);
      }
    });
  };

  return { value, setValue, update, saved, setSaved, dirty, errors, setErrors, error, setError, pending, save, savedAt, setSavedAt };
}

export function SectionCard({
  id,
  title,
  intro,
  dirty = false,
  pending = false,
  error,
  savedAt = 0,
  onSave,
  saveLabel,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  dirty?: boolean;
  pending?: boolean;
  error?: string | null;
  savedAt?: number;
  onSave?: () => void; // no onSave → no Save button (e.g. lists that save right away)
  saveLabel?: string;
  children: React.ReactNode;
}) {
  const { set, readOnly } = useContext(DirtyContext);
  useEffect(() => {
    set(id, dirty && !readOnly);
    return () => set(id, false);
  }, [id, dirty, readOnly, set]);

  const showSaved = savedAt > 0;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 rounded-bo-card border border-bo-border bg-bo-card p-5 md:scroll-mt-6 md:p-6"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${id}-title`} className="font-bo-heading text-xl font-semibold">{title}</h2>
          {intro && <p className="mt-1 text-sm text-bo-muted">{intro}</p>}
        </div>
        {dirty && !readOnly && (
          <span className="rounded-full bg-bo-attention-bg px-2.5 py-1 text-xs font-semibold text-bo-attention-text">
            {s.unsaved}
          </span>
        )}
      </div>

      {/* Staff: every input inside is disabled at once. */}
      <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5">
        {children}
      </fieldset>

      {(onSave || error) && (
        <div className="mt-6 flex flex-col gap-3 border-t border-bo-border pt-4">
          {error && (
            <p role="alert" className="rounded-xl bg-status-refused-bg p-3 text-sm text-status-refused-fg">{error}</p>
          )}
          {onSave && !readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={onSave} disabled={pending || !dirty} className={primaryButton}>
                {pending ? s.saving : (saveLabel ?? s.save)}
              </button>
              <span role="status" aria-live="polite" className="text-sm font-semibold text-status-paid-fg">
                {showSaved && !dirty ? s.saved : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ fields
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  counter,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor: string;
  counter?: { count: number; max: number };
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-bo-ink">{label}</label>
        {counter && (
          <span className={`text-xs ${counter.count > counter.max ? "font-semibold text-status-refused-fg" : "text-bo-muted"}`}>
            {fill(s.chars, counter)}
          </span>
        )}
      </div>
      {children}
      {hint && !error && <p id={`${htmlFor}-hint`} className="text-sm text-bo-muted">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} className="text-sm font-medium text-status-refused-fg">{error}</p>
      )}
    </div>
  );
}

type TextProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string;
  max?: number;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: string;
  autoComplete?: string;
  prefix?: string;
  className?: string;
};

export function TextField(p: TextProps) {
  const id = useId();
  const describedBy = p.error ? `${id}-error` : p.hint ? `${id}-hint` : undefined;
  const common = {
    id,
    value: p.value,
    placeholder: p.placeholder,
    "aria-invalid": !!p.error,
    "aria-describedby": describedBy,
    className: `${inputClass} ${p.className ?? ""}`,
  };
  return (
    <Field
      label={p.label}
      hint={p.hint}
      error={p.error}
      htmlFor={id}
      counter={p.max && p.max >= 100 ? { count: p.value.length, max: p.max } : undefined}
    >
      {p.multiline ? (
        <textarea {...common} rows={p.rows ?? 3} onChange={(e) => p.onChange(e.target.value)} className={`${common.className} py-3`} />
      ) : p.prefix ? (
        <div className="flex items-stretch">
          <span className="inline-flex items-center rounded-l-xl border border-r-0 border-bo-border bg-bo-page px-3 text-bo-muted">
            {p.prefix}
          </span>
          <input
            {...common}
            type={p.type ?? "text"}
            inputMode={p.inputMode}
            autoComplete={p.autoComplete ?? "off"}
            onChange={(e) => p.onChange(e.target.value)}
            className={`${common.className} rounded-l-none`}
          />
        </div>
      ) : (
        <input
          {...common}
          type={p.type ?? "text"}
          inputMode={p.inputMode}
          autoComplete={p.autoComplete ?? "off"}
          onChange={(e) => p.onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** On/off switch (a real button with role="switch"). */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-base font-semibold text-bo-ink">{label}</label>
        {hint && <p className="mt-0.5 text-sm text-bo-muted">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="group inline-flex min-h-11 shrink-0 items-center gap-2 disabled:opacity-60"
      >
        <span className="text-sm font-medium text-bo-muted">{checked ? s.on : s.off}</span>
        <span
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${checked ? "bg-bo-accent" : "bg-zinc-300"}`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
          />
        </span>
      </button>
    </div>
  );
}

/** Two or more choices as big radio buttons. */
export function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-semibold text-bo-ink">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 ${value === o.value ? "border-bo-accent bg-bo-accent/5" : "border-bo-border bg-white"}`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-5 w-5 accent-bo-accent"
            />
            <span className="text-base">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Small grey box for previews and notes. */
export function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warning" }) {
  return (
    <div
      className={`rounded-xl p-3 text-sm ${tone === "warning" ? "bg-bo-attention-bg text-bo-attention-text" : "bg-bo-page text-bo-muted"}`}
    >
      {children}
    </div>
  );
}

/** "15.5" for an input from a number (null → ""). */
export const moneyText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
