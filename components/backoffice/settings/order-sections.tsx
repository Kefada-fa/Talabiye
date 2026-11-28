"use client";

import { useState } from "react";
import { brand } from "@/config/brand";
import {
  saveDepositsAction,
  saveNotificationsAction,
  savePrefixAction,
  saveTemplatesAction,
} from "@/app/dashboard/settings/actions";
import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import { renderTemplate, TEMPLATE_PLACEHOLDERS, templateText, unknownPlaceholders } from "@/lib/settings/templates";
import type { ShopSettings } from "@/lib/settings/types";
import {
  TEMPLATE_KEYS,
  validateDeposits,
  validateEmail,
  validateNotifications,
  validatePrefix,
  validateTemplates,
  type TemplateKey,
} from "@/lib/settings/validate";
import {
  Choice,
  dangerButton,
  inputClass,
  moneyText,
  Note,
  SectionCard,
  secondaryButton,
  TextField,
  Toggle,
  useSection,
} from "./kit";

const s = t.backoffice.settings;

// ---------------------------------------------------------------- deposits
export function DepositsSection({ settings }: { settings: ShopSettings }) {
  const d = s.deposits;
  const sec = useSection({
    depositOn: settings.depositOn,
    type: settings.depositType,
    amount: moneyText(settings.depositAmount),
    instructions: settings.depositInstructions ?? "",
  });
  const v = sec.value;
  return (
    <SectionCard
      id="deposits"
      title={d.title}
      intro={d.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save(saveDepositsAction, (x) => validateDeposits(x).errors)}
    >
      <Toggle label={d.on} checked={v.depositOn} onChange={(x) => sec.update("depositOn", x)} />
      {v.depositOn && (
        <div className="flex flex-col gap-5 border-l-4 border-bo-border pl-4">
          <Choice
            label={d.type}
            value={v.type}
            onChange={(x) => sec.update("type", x)}
            options={[
              { value: "fixed", label: d.fixed },
              { value: "delivery_fee", label: d.sameAsDelivery },
            ]}
          />
          {v.type === "fixed" && (
            <TextField label={d.amount} value={v.amount} onChange={(x) => sec.update("amount", x)} error={sec.errors.amount} inputMode="decimal" prefix="$" className="max-w-40" />
          )}
          <TextField
            label={d.instructions}
            hint={d.instructionsHint}
            placeholder={d.instructionsPlaceholder}
            value={v.instructions}
            onChange={(x) => sec.update("instructions", x)}
            error={sec.errors.instructions}
            max={300}
            multiline
            rows={2}
          />
        </div>
      )}
    </SectionCard>
  );
}

// -------------------------------------------------------------- templates
export function TemplatesSection({ settings }: { settings: ShopSettings }) {
  const tp = s.templates;
  const sec = useSection<Record<TemplateKey, string>>({
    confirm: templateText("confirm", settings.templates.confirm),
    deposit: templateText("deposit", settings.templates.deposit),
    review: templateText("review", settings.templates.review),
  });

  // Example data for the preview.
  const amount = settings.depositType === "fixed" ? (settings.depositAmount ?? 5) : 3;
  const sample = {
    name: tp.sample.name,
    order_number: tp.sample.orderNumber,
    total: formatPrice(48),
    items: tp.sample.items,
    address: tp.sample.address,
    deposit: formatPrice(amount),
    review_link: `https://${brand.domain}/${settings.slug}/review/…`,
  };
  const labels: Record<TemplateKey, string> = { confirm: tp.confirm, deposit: tp.deposit, review: tp.review };

  return (
    <SectionCard
      id="whatsapp"
      title={tp.title}
      intro={tp.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save(saveTemplatesAction, (x) => validateTemplates(x).errors)}
    >
      <Note>
        {tp.placeholders}{" "}
        {TEMPLATE_PLACEHOLDERS.map((p) => (
          <code key={p} className="mr-1.5 inline-block rounded bg-white px-1.5 py-0.5 font-mono text-xs text-bo-ink">{`{${p}}`}</code>
        ))}
      </Note>

      {TEMPLATE_KEYS.map((key) => {
        const text = sec.value[key];
        const unknown = unknownPlaceholders(text);
        const isDefault = text === tp.defaults[key];
        let preview = renderTemplate(text, sample);
        if (key === "deposit" && settings.depositInstructions) preview += `\n\n${settings.depositInstructions}`;
        return (
          <div key={key} className="flex flex-col gap-3 rounded-xl border border-bo-border p-4">
            <TextField
              label={labels[key]}
              value={text}
              onChange={(x) => sec.update(key, x)}
              error={sec.errors[key]}
              max={1000}
              multiline
              rows={5}
            />
            {unknown.length > 0 && <Note tone="warning">{fill(tp.unknown, { list: unknown.join(", ") })}</Note>}
            {!isDefault && (
              <button type="button" className={`${secondaryButton} w-fit`} onClick={() => sec.update(key, tp.defaults[key])}>
                {tp.reset}
              </button>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-bo-muted">{tp.preview}</span>
              <p className="max-w-md whitespace-pre-line rounded-xl rounded-tl-none bg-[#dcf8c6] p-3 text-sm text-zinc-900 shadow-sm">
                {preview}
              </p>
            </div>
          </div>
        );
      })}
    </SectionCard>
  );
}

// ---------------------------------------------------------- notifications
export function NotificationsSection({ settings }: { settings: ShopSettings }) {
  const n = s.notifications;
  const sec = useSection({ emailEnabled: settings.emailEnabled, emails: settings.orderEmails });
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const emails = sec.value.emails;

  function add() {
    const email = draft.trim();
    if (!validateEmail(email)) return setDraftError(n.errors.email);
    if (emails.some((e) => e.toLowerCase() === email.toLowerCase())) return setDraftError(n.errors.duplicate);
    if (emails.length >= 3) return setDraftError(n.errors.max);
    sec.update("emails", [...emails, email]);
    setDraft("");
    setDraftError(null);
  }

  return (
    <SectionCard
      id="notifications"
      title={n.title}
      intro={n.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save(saveNotificationsAction, (x) => validateNotifications(x).errors)}
    >
      <Toggle label={n.on} checked={sec.value.emailEnabled} onChange={(x) => sec.update("emailEnabled", x)} />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-bo-ink">{n.emails}</span>
        {emails.length === 0 ? (
          <p className="text-sm text-bo-muted">{n.none}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {emails.map((email) => (
              <li key={email} className="flex items-center justify-between gap-2 rounded-xl border border-bo-border px-4 py-1">
                <span className="min-w-0 truncate">{email}</span>
                <button
                  type="button"
                  className={dangerButton}
                  aria-label={fill(n.remove, { email })}
                  onClick={() => sec.update("emails", emails.filter((e) => e !== email))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {sec.errors.emails && <p className="text-sm font-medium text-status-refused-fg">{sec.errors.emails}</p>}
        {emails.length < 3 && (
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              aria-label={n.addPlaceholder}
              placeholder={n.addPlaceholder}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              className={`${inputClass} min-w-0 flex-1`}
              aria-invalid={!!draftError}
            />
            <button type="button" className={secondaryButton} onClick={add}>{n.add}</button>
          </div>
        )}
        {draftError && <p className="text-sm font-medium text-status-refused-fg">{draftError}</p>}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- invoices
export function InvoicesSection({ settings }: { settings: ShopSettings }) {
  const inv = s.invoices;
  const sec = useSection({ prefix: settings.invoicePrefix });
  const prefix = sec.value.prefix.trim().toUpperCase();
  return (
    <SectionCard
      id="invoices"
      title={inv.title}
      intro={inv.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save(savePrefixAction, (x) => validatePrefix(x).errors)}
    >
      <TextField
        label={inv.prefix}
        hint={inv.prefixHint}
        value={sec.value.prefix}
        onChange={(x) => sec.update("prefix", x.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
        error={sec.errors.prefix}
        className="max-w-40 font-mono uppercase"
      />
      <Note>
        {prefix.length >= 2 && fill(inv.example, { example: `${prefix}-0001` })} {inv.oldKeep}
      </Note>
    </SectionCard>
  );
}

