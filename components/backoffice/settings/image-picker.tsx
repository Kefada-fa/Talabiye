"use client";

import { useId, useRef, useState } from "react";
import { saveShopImageAction } from "@/app/dashboard/settings/actions";
import { t } from "@/lib/i18n";
import { ACCEPT_ATTR, ImageError, prepareImage, type PreparedImage } from "@/lib/settings/image";
import type { SaveResult } from "@/lib/settings/types";
import { createClient } from "@/lib/supabase/client";
import { SHOP_ASSETS_BUCKET } from "@/lib/storefront/photos";
import { dangerButton, secondaryButton } from "./kit";

const m = t.backoffice.settings.image;

/** What the owner chose: keep the current picture, a new one, or none. */
export type ImageChoice = { kind: "keep" } | { kind: "new"; image: PreparedImage } | { kind: "remove" };

/**
 * Uploads a new picture (with the user's own login — storage rules allow
 * only the shop's owners, inside the shop's folder), then saves its path.
 * "remove" clears the path (the server deletes the old file).
 */
export async function saveImageChoice(
  shopId: string,
  kind: "logo" | "share",
  choice: ImageChoice,
): Promise<SaveResult> {
  if (choice.kind === "keep") return { ok: true };
  if (choice.kind === "remove") return saveShopImageAction(kind, null);

  const path = `${shopId}/${kind}-${crypto.randomUUID()}.${choice.image.ext}`;
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(SHOP_ASSETS_BUCKET)
    .upload(path, choice.image.blob, { contentType: choice.image.type, cacheControl: "31536000", upsert: false });
  if (error) {
    console.error("[settings] upload:", error.message);
    return { ok: false, error: m.uploadFailed };
  }
  const res = await saveShopImageAction(kind, path);
  if (!res.ok) await supabase.storage.from(SHOP_ASSETS_BUCKET).remove([path]); // don't leave it behind
  return res;
}

export function ImagePicker({
  kind,
  label,
  hint,
  currentUrl,
  choice,
  onChange,
  chooseLabel,
  changeLabel,
  removeLabel,
  readOnly,
}: {
  kind: "logo" | "share";
  label: string;
  hint: string;
  currentUrl: string | null;
  choice: ImageChoice;
  onChange: (c: ImageChoice) => void;
  chooseLabel: string;
  changeLabel: string;
  removeLabel: string;
  readOnly: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownUrl = choice.kind === "new" ? choice.image.url : choice.kind === "remove" ? null : currentUrl;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange({ kind: "new", image: await prepareImage(file, kind) });
    } catch (e) {
      setError(e instanceof ImageError ? e.message : m.cantRead);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = ""; // allow choosing the same file again
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm font-semibold text-bo-ink">{label}</span>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`flex shrink-0 items-center justify-center overflow-hidden border border-bo-border bg-bo-page ${kind === "logo" ? "h-20 w-20 rounded-full" : "aspect-[1200/630] w-full max-w-xs rounded-xl"}`}
        >
          {shownUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview / storage URL
            <img src={shownUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="px-2 text-center text-xs text-bo-muted">—</span>
          )}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              id={id}
              type="file"
              accept={ACCEPT_ATTR}
              className="sr-only"
              aria-labelledby={`${id}-label`}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => input.current?.click()}>
              {busy ? t.common.loading : shownUrl ? changeLabel : chooseLabel}
            </button>
            {(choice.kind === "new" || (choice.kind === "keep" && currentUrl)) && (
              <button
                type="button"
                className={dangerButton}
                onClick={() => onChange(currentUrl ? { kind: "remove" } : { kind: "keep" })}
              >
                {removeLabel}
              </button>
            )}
            {choice.kind === "remove" && (
              <button type="button" className={secondaryButton} onClick={() => onChange({ kind: "keep" })}>
                {t.backoffice.settings.lists.cancel}
              </button>
            )}
          </div>
        )}
      </div>
      {choice.kind === "new" && <p className="text-sm font-medium text-bo-attention-text">{m.newPreview}</p>}
      {error ? <p className="text-sm font-medium text-status-refused-fg">{error}</p> : <p className="text-sm text-bo-muted">{hint}</p>}
    </div>
  );
}
