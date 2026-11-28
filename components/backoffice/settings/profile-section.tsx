"use client";

import { useState } from "react";
import { brand } from "@/config/brand";
import { saveProfileAction } from "@/app/dashboard/settings/actions";
import { fill, t } from "@/lib/i18n";
import { contrastRatio, MIN_CONTRAST } from "@/lib/settings/contrast";
import type { ShopSettings } from "@/lib/settings/types";
import { HEX_RE, validateProfile } from "@/lib/settings/validate";
import { ImagePicker, saveImageChoice, type ImageChoice } from "./image-picker";
import { Field, inputClass, Note, SectionCard, secondaryButton, TextField, useReadOnly, useSection } from "./kit";

const p = t.backoffice.settings.profile;

/** "+96170123456" → "70 123 456" (how people type it). */
function localPhone(e164: string | null): string {
  if (!e164) return "";
  const d = e164.replace(/^\+961/, "");
  return d.length === 7 ? `0${d.slice(0, 1)} ${d.slice(1, 4)} ${d.slice(4)}` : `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
}

export function ProfileSection({ settings }: { settings: ShopSettings }) {
  const readOnly = useReadOnly();
  const sec = useSection({
    name: settings.name,
    tagline: settings.tagline ?? "",
    heroText: settings.heroText ?? "",
    whatsapp: localPhone(settings.whatsapp),
    instagram: settings.instagram ?? "",
    facebook: settings.facebook ?? "",
    primaryColor: settings.primaryColor ?? "",
    accentColor: settings.accentColor ?? "",
  });
  const [logo, setLogo] = useState<ImageChoice>({ kind: "keep" });
  const [copied, setCopied] = useState(false);
  const v = sec.value;
  const e = sec.errors;

  const shopUrl = `${brand.domain}/${settings.slug}`;

  function onSave() {
    sec.save(
      async (value) => {
        // Picture first (upload + save its path), then the text fields.
        const img = await saveImageChoice(settings.shopId, "logo", logo);
        if (!img.ok) return img;
        if (logo.kind !== "keep") setLogo({ kind: "keep" });
        return saveProfileAction(value);
      },
      (value) => validateProfile(value).errors,
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`https://${shopUrl}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  return (
    <SectionCard
      id="profile"
      title={p.title}
      intro={p.intro}
      dirty={sec.dirty || logo.kind !== "keep"}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={onSave}
    >
      <TextField label={p.name} value={v.name} onChange={(x) => sec.update("name", x)} error={e.name} max={100} />
      <TextField label={p.tagline} hint={p.taglineHint} value={v.tagline} onChange={(x) => sec.update("tagline", x)} error={e.tagline} max={80} />
      <TextField label={p.hero} hint={p.heroHint} value={v.heroText} onChange={(x) => sec.update("heroText", x)} error={e.heroText} max={300} multiline rows={2} />

      <Field label={p.address} hint={p.addressHint} htmlFor="shop-address">
        <div className="flex flex-wrap gap-2">
          <input id="shop-address" readOnly value={shopUrl} className={`${inputClass} flex-1 bg-bo-page`} />
          <button type="button" onClick={copy} className={secondaryButton} disabled={false}>
            {copied ? p.copied : p.copy}
          </button>
        </div>
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <TextField label={p.whatsapp} hint={p.whatsappHint} value={v.whatsapp} onChange={(x) => sec.update("whatsapp", x)} error={e.whatsapp} type="tel" inputMode="tel" placeholder="70 123 456" />
        <TextField label={p.instagram} hint={p.instagramHint} value={v.instagram} onChange={(x) => sec.update("instagram", x)} error={e.instagram} prefix="@" />
      </div>
      <TextField label={p.facebook} hint={p.facebookHint} value={v.facebook} onChange={(x) => sec.update("facebook", x)} error={e.facebook} type="url" inputMode="url" placeholder="https://facebook.com/…" />

      <ImagePicker
        kind="logo"
        label={p.logo}
        hint={p.logoHint}
        currentUrl={settings.logoUrl}
        choice={logo}
        onChange={setLogo}
        chooseLabel={p.chooseLogo}
        changeLabel={p.changeLogo}
        removeLabel={p.removeLogo}
        readOnly={readOnly}
      />

      <div className="flex flex-col gap-4">
        <span className="text-sm font-semibold text-bo-ink">{p.colors}</span>
        <div className="grid gap-5 md:grid-cols-2">
          <ColorField label={p.primary} value={v.primaryColor} fallback={brand.colors.primary} error={e.primaryColor} onChange={(x) => sec.update("primaryColor", x)} />
          <ColorField label={p.accent} value={v.accentColor} fallback={brand.colors.accent} error={e.accentColor} onChange={(x) => sec.update("accentColor", x)} />
        </div>
        <ColorPreview
          name={v.name || settings.name}
          logoInitial={(v.name || settings.name).trim().charAt(0).toUpperCase()}
          primary={HEX_RE.test(v.primaryColor) ? v.primaryColor : brand.colors.primary}
          accent={HEX_RE.test(v.accentColor) ? v.accentColor : brand.colors.accent}
        />
      </div>
    </SectionCard>
  );
}

function ColorField({
  label,
  value,
  fallback,
  error,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const shown = HEX_RE.test(value) ? value : fallback;
  const ratio = contrastRatio(shown, "#FFFFFF");
  const id = `color-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} hint={p.colorHint} error={error} htmlFor={id}>
        <div className="flex gap-2">
          <input
            type="color"
            aria-label={label}
            value={shown.toLowerCase()}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-bo-border bg-white p-1"
          />
          <input
            id={id}
            value={value}
            placeholder={fallback}
            maxLength={7}
            onChange={(e) => onChange(e.target.value.trim())}
            aria-invalid={!!error}
            className={`${inputClass} font-mono uppercase`}
          />
          {value && (
            <button type="button" onClick={() => onChange("")} className={secondaryButton}>
              {p.resetColor}
            </button>
          )}
        </div>
      </Field>
      {ratio !== null && ratio < MIN_CONTRAST && (
        <Note tone="warning">{fill(p.contrastWarning, { ratio: ratio.toFixed(1) })}</Note>
      )}
    </div>
  );
}

/** Mini preview: a shop header and a button in the chosen colors. */
function ColorPreview({ name, logoInitial, primary, accent }: { name: string; logoInitial: string; primary: string; accent: string }) {
  return (
    <div aria-label={p.preview} className="overflow-hidden rounded-xl border border-bo-border bg-zinc-50">
      <p className="border-b border-bo-border bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-bo-muted">
        {p.preview}
      </p>
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full text-base font-bold text-white" style={{ backgroundColor: primary }}>
          {logoInitial || "?"}
        </span>
        <span className="truncate font-semibold text-zinc-900">{name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className="rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ backgroundColor: accent }}>
          {p.previewSale}
        </span>
        <span className="rounded-full px-5 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: primary }}>
          {p.previewButton}
        </span>
      </div>
    </div>
  );
}
