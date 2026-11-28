"use client";

import { useRef, useState, useTransition } from "react";
import { addPhotosAction, removePhotoAction, reorderPhotosAction } from "@/app/dashboard/inventory/actions";
import { fill, t } from "@/lib/i18n";
import { removeUploaded, uploadProductPhotos } from "@/lib/inventory/upload";
import type { InvPhoto } from "@/lib/inventory/types";
import { ACCEPT_ATTR, ImageError, prepareImage, type PreparedImage } from "@/lib/settings/image";
import { secondaryButton } from "@/components/backoffice/settings/kit";

const ph = t.backoffice.inventory.photos;
const f = t.backoffice.inventory.form;

export type PendingPhoto = { localId: string; image: PreparedImage };

/** One shown photo: saved (existing item) or pending (new item, uploaded on Save). */
type Shown = { id: string; url: string; pending: boolean };

/**
 * Existing item: every change is saved right away (upload, order, remove).
 * New item: photos wait in the browser and are uploaded when the item is saved.
 */
export function PhotosEditor({
  shopId,
  productId,
  isNew,
  saved,
  pending,
  onPending,
  onSavedChange,
  max,
}: {
  shopId: string;
  productId: string;
  isNew: boolean;
  saved: InvPhoto[];
  pending: PendingPhoto[];
  onPending: (p: PendingPhoto[]) => void;
  onSavedChange: (p: InvPhoto[]) => void;
  max: number;
}) {
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const shown: Shown[] = isNew
    ? pending.map((p) => ({ id: p.localId, url: p.image.url, pending: true }))
    : saved.map((p) => ({ id: p.id, url: p.url, pending: false }));
  const room = max - shown.length;

  async function prepareAll(files: FileList | null): Promise<PreparedImage[]> {
    const list = Array.from(files ?? []);
    if (list.length > room) {
      setError(fill(ph.limit, { max }));
    }
    const out: PreparedImage[] = [];
    for (const file of list.slice(0, Math.max(room, 0))) {
      try {
        out.push(await prepareImage(file, "product"));
      } catch (e) {
        setError(e instanceof ImageError ? e.message : t.backoffice.settings.image.cantRead);
      }
    }
    return out;
  }

  function onFiles(files: FileList | null) {
    setError(null);
    startTransition(async () => {
      const images = await prepareAll(files);
      if (gallery.current) gallery.current.value = "";
      if (camera.current) camera.current.value = "";
      if (images.length === 0) return;
      if (isNew) {
        onPending([...pending, ...images.map((image) => ({ localId: crypto.randomUUID(), image }))]);
        return;
      }
      let paths: string[] = [];
      try {
        paths = await uploadProductPhotos(shopId, productId, images);
      } catch {
        setError(t.backoffice.settings.image.uploadFailed);
        return;
      }
      const res = await addPhotosAction(productId, paths);
      if (!res.ok) {
        await removeUploaded(paths); // never leave files without a photo row
        setError(res.error);
        return;
      }
      const byPath = new Map(res.photos.map((p) => [p.path, p.id]));
      onSavedChange([
        ...saved,
        ...paths.map((path, i) => ({ id: byPath.get(path) ?? path, path, url: images[i].url })),
      ]);
    });
  }

  function move(index: number, to: number) {
    if (to < 0 || to >= shown.length) return;
    if (isNew) {
      const next = [...pending];
      const [x] = next.splice(index, 1);
      next.splice(to, 0, x);
      onPending(next);
      return;
    }
    const next = [...saved];
    const [x] = next.splice(index, 1);
    next.splice(to, 0, x);
    onSavedChange(next);
    startTransition(async () => {
      const res = await reorderPhotosAction(productId, next.map((p) => p.id));
      if (!res.ok) setError(res.error);
    });
  }

  function remove(index: number) {
    if (isNew) {
      onPending(pending.filter((_, i) => i !== index));
      return;
    }
    if (!window.confirm(ph.removeConfirm)) return;
    const photo = saved[index];
    startTransition(async () => {
      const res = await removePhotoAction(photo.id);
      if (!res.ok) setError(res.error);
      else onSavedChange(saved.filter((p) => p.id !== photo.id));
    });
  }

  const small =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-white/90 px-2 text-sm font-semibold text-bo-ink shadow disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t.backoffice.inventory.form.photos}</span>
        <span className="text-sm text-bo-muted">{fill(f.photosCount, { count: shown.length, max })}</span>
      </div>

      {shown.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {shown.map((p, i) => (
            <li key={p.id} className="relative aspect-square overflow-hidden rounded-xl border border-bo-border bg-bo-page">
              {/* eslint-disable-next-line @next/next/no-img-element -- storage / local preview */}
              <img src={p.url} alt={fill(ph.alt, { n: i + 1 })} className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-bo-accent px-2 py-0.5 text-[11px] font-semibold text-white">{ph.main}</span>
              )}
              <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between gap-1">
                <span className="flex gap-1">
                  <button type="button" className={small} aria-label={ph.moveLeft} disabled={busy || i === 0} onClick={() => move(i, i - 1)}>‹</button>
                  {i > 0 && (
                    <button type="button" className={small} aria-label={ph.makeMain} title={ph.makeMain} disabled={busy} onClick={() => move(i, 0)}>★</button>
                  )}
                  <button type="button" className={small} aria-label={ph.moveRight} disabled={busy || i === shown.length - 1} onClick={() => move(i, i + 1)}>›</button>
                </span>
                <button type="button" className={`${small} text-status-refused-fg`} aria-label={ph.remove} disabled={busy} onClick={() => remove(i)}>✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {room > 0 && (
        <div className="flex flex-wrap gap-2">
          <input ref={gallery} type="file" accept={ACCEPT_ATTR} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFiles(e.target.files)} />
          <input ref={camera} type="file" accept={ACCEPT_ATTR} capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFiles(e.target.files)} />
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => gallery.current?.click()}>
            {busy ? ph.working : `+ ${ph.add}`}
          </button>
          <button type="button" className={`${secondaryButton} md:hidden`} disabled={busy} onClick={() => camera.current?.click()}>
            {ph.camera}
          </button>
        </div>
      )}
      <p className="text-sm text-bo-muted">{isNew && shown.length > 0 ? f.photosAfterSave : ph.hint}</p>
      {error && <p role="alert" className="text-sm font-medium text-status-refused-fg">{error}</p>}
    </div>
  );
}

/** Prepares ONE photo for an option value ("Upload new"). */
export async function prepareOne(file: File): Promise<PreparedImage> {
  return prepareImage(file, "product");
}
