"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteItemAction,
  saveItemAction,
  setValuePhotosAction,
  setVisibilityAction,
  addPhotosAction,
  setPhotoFocusAction,
} from "@/app/dashboard/inventory/actions";
import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import {
  buildPayload,
  emptyForm,
  newKey,
  parseMoney,
  structureChanged,
  validateForm,
  type ItemForm,
  type StructureNote,
} from "@/lib/inventory/form";
import { removeUploaded, uploadProductPhotos } from "@/lib/inventory/upload";
import type { InvItem, InvPhoto, InventoryData } from "@/lib/inventory/types";
import { ImageError } from "@/lib/settings/image";
import { useLeaveGuard } from "@/components/backoffice/leave-guard";
import {
  dangerButton,
  inputClass,
  Note,
  primaryButton,
  secondaryButton,
  TextField,
  Toggle,
} from "@/components/backoffice/settings/kit";
import { OptionsEditor, StockGrid, type PhotoChoice } from "./options-editor";
import { DEFAULT_FOCUS, type PhotoFocus } from "@/components/photo/focused-photo";
import { AdjustPhotoDialog } from "./adjust-photo";
import { PhotoViewer } from "./photo-viewer";
import { PhotosEditor, prepareOne, shownPhotos, type PendingPhoto } from "./photos-editor";
import { QuickStock } from "./quick-stock";

const inv = t.backoffice.inventory;
const f = inv.form;
const o = inv.options;

function Card({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-bo-card border border-bo-border bg-bo-card p-5 md:p-6">
      <div>
        <h2 className="font-bo-heading text-xl font-semibold">{title}</h2>
        {intro && <p className="mt-1 text-sm text-bo-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export function ItemEditor({
  data,
  item,
  initial,
  orderedValueIds,
  orderCount,
  duplicated,
  flash,
  warning,
}: {
  data: InventoryData;
  item: InvItem | null; // null = new item
  initial: ItemForm;
  orderedValueIds: string[];
  orderCount: number;
  duplicated: boolean;
  flash: string | null;
  warning: string | null;
}) {
  const router = useRouter();
  const [form, setFormState] = useState(initial);
  const [savedForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<StructureNote>(null);
  const [photos, setPhotos] = useState<InvPhoto[]>(item?.photos ?? []);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [newCollection, setNewCollection] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [moreOpen, setMoreOpen] = useState(!!(initial.brand || initial.expiryDate || initial.barcode || initial.weight));
  const [deleting, setDeleting] = useState(false);
  // Photos waiting for "Adjust" (after adding them), and the full view.
  const [adjustQueue, setAdjustQueue] = useState<{ keys: string[]; total: number }>({ keys: [], total: 0 });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [busy, startTransition] = useTransition();

  const isNew = form.isNew;
  // (the id is not a change: a fresh form gets a new one)
  const dirty = JSON.stringify({ ...form, id: "" }) !== JSON.stringify({ ...savedForm, id: "" }) || pending.length > 0;
  const allowLeave = useLeaveGuard(dirty, f.leaveWarning);
  const setForm = (next: ItemForm) => {
    setFormState(next);
    setError(null);
  };
  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) => setForm({ ...form, [k]: v });

  // ---- photo choices for option values ----
  const photoChoices: PhotoChoice[] = [
    ...photos.map((p, i) => ({ ref: { kind: "saved" as const, id: p.id }, url: p.url, label: fill(inv.photos.alt, { n: i + 1 }) })),
    ...pending.map((p, i) => ({
      ref: { kind: "pending" as const, localId: p.localId },
      url: p.image.url,
      label: fill(inv.photos.alt, { n: photos.length + i + 1 }),
    })),
  ];

  function uploadForValue(typeIndex: number, valueKey: string, file: File) {
    setError(null);
    startTransition(async () => {
      if (photos.length + pending.length >= data.maxPhotos) {
        setError(fill(inv.photos.limit, { max: data.maxPhotos }));
        return;
      }
      try {
        const image = await prepareOne(file);
        let ref: ItemForm["types"][number]["values"][number]["photo"];
        if (isNew) {
          const localId = crypto.randomUUID();
          setPending((old) => [...old, { localId, image, focus: DEFAULT_FOCUS }]);
          setAdjustQueue({ keys: [localId], total: 1 });
          ref = { kind: "pending", localId };
        } else {
          const paths = await uploadProductPhotos(data.shopId, form.id, [image]);
          const res = await addPhotosAction(form.id, paths);
          if (!res.ok) {
            await removeUploaded(paths);
            setError(res.error);
            return;
          }
          const saved = { id: res.photos[0].id, path: paths[0], url: image.url, focus: DEFAULT_FOCUS };
          setPhotos((old) => [...old, saved]);
          setAdjustQueue({ keys: [saved.id], total: 1 });
          ref = { kind: "saved", id: saved.id };
        }
        setFormState((cur) => ({
          ...cur,
          types: cur.types.map((ty, i) =>
            i === typeIndex ? { ...ty, values: ty.values.map((v) => (v.key === valueKey ? { ...v, photo: ref } : v)) } : ty,
          ),
        }));
      } catch (e) {
        setError(e instanceof ImageError ? e.message : t.backoffice.settings.image.uploadFailed);
      }
    });
  }

  // ---- photo position (Adjust) ----
  const shown = shownPhotos(isNew, photos, pending);
  const adjustKey = adjustQueue.keys[0];
  const adjusting = adjustKey ? shown.find((p) => p.key === adjustKey) : undefined;
  const nextAdjust = () => setAdjustQueue((q) => ({ keys: q.keys.slice(1), total: q.keys.length > 1 ? q.total : 0 }));

  function saveFocus(key: string, focus: PhotoFocus) {
    if (isNew) {
      // Saved with the photo when the item is saved.
      setPending((old) => old.map((p) => (p.localId === key ? { ...p, focus } : p)));
      nextAdjust();
      return;
    }
    setAdjustSaving(true);
    startTransition(async () => {
      const res = await setPhotoFocusAction(key, focus);
      setAdjustSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhotos((old) => old.map((p) => (p.id === key ? { ...p, focus } : p)));
      nextAdjust();
    });
  }

  // ---- quick stock on this page: keep the form in step ----
  function onQuickStock(variantId: string | null, stockNow: number) {
    setFormState((cur) => {
      if (variantId === null) {
        const untouched = cur.stockBase !== undefined && cur.stock === (cur.stockBase === null ? "" : String(cur.stockBase));
        return untouched ? { ...cur, stock: String(stockNow), stockBase: stockNow } : { ...cur, stockBase: stockNow };
      }
      const v = item?.variants.find((x) => x.id === variantId);
      if (!v?.value1Id) return cur;
      const key = v.value2Id ? `${v.value1Id}|${v.value2Id}` : v.value1Id;
      const cell = cur.cells[key];
      if (!cell) return cur;
      const untouched = cell.stock === (cell.base === null || cell.base === undefined ? "" : String(cell.base));
      return { ...cur, cells: { ...cur.cells, [key]: { ...cell, base: stockNow, stock: untouched ? String(stockNow) : cell.stock } } };
    });
  }

  // ---- save ----
  function save(addAnother: boolean) {
    const errs = validateForm(form, data.isOwner);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError(f.errors.fix);
      return;
    }
    if (structureChanged(form, savedForm) && !window.confirm(o.confirmStructure)) return;
    setError(null);

    startTransition(async () => {
      const res = await saveItemAction(isNew ? null : form.id, buildPayload(form, data.isOwner));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      let photoProblem = false;

      if (isNew && pending.length > 0) {
        // Upload the waiting photos. If anything fails, delete what was
        // uploaded (no orphan files) — the item itself is saved.
        let paths: string[] = [];
        try {
          paths = await uploadProductPhotos(data.shopId, res.productId, pending.map((p) => p.image));
          const added = await addPhotosAction(res.productId, paths, pending.map((p) => p.focus));
          if (!added.ok) throw new Error(added.error);
          const idByPath = new Map(added.photos.map((p) => [p.path, p.id]));
          const idByLocal = new Map(pending.map((p, i) => [p.localId, idByPath.get(paths[i]) ?? null]));
          const links: Record<string, string | null> = {};
          for (const ty of form.types)
            for (const v of ty.values)
              if (v.photo?.kind === "pending" && res.valueIds[v.key]) links[res.valueIds[v.key]] = idByLocal.get(v.photo.localId) ?? null;
          if (Object.keys(links).length > 0) await setValuePhotosAction(res.productId, links);
        } catch {
          await removeUploaded(paths);
          photoProblem = true;
        }
      }

      allowLeave();
      if (isNew) {
        // Next.js keeps visited pages in the background: start this page
        // over with an EMPTY form and a NEW id, so coming back to "Add item"
        // never shows (or re-saves) the item that was just saved.
        setFormState(emptyForm(crypto.randomUUID()));
        setPending([]);
        setNote(null);
      }
      if (addAnother) {
        // A fresh, empty form (the page starts over for every new URL).
        router.push(`/dashboard/inventory/new?added=${encodeURIComponent(form.name.trim().slice(0, 80))}&n=${newKey().slice(0, 8)}${photoProblem ? "&photos=failed" : ""}`);
        return;
      }
      router.replace(`/dashboard/inventory/${res.productId}?saved=${newKey().slice(0, 8)}${photoProblem ? "&photos=failed" : ""}`);
    });
  }

  function toggleVisibility() {
    if (!item) return;
    startTransition(async () => {
      const res = await setVisibilityAction(item.id, !item.isActive);
      if (!res.ok) setError(res.error);
      else router.replace(`/dashboard/inventory/${item.id}?saved=${newKey().slice(0, 8)}`);
    });
  }

  function doDelete() {
    if (!item) return;
    startTransition(async () => {
      const res = await deleteItemAction(item.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      allowLeave();
      router.push("/dashboard/inventory");
    });
  }

  // ---- profit hint (owners) ----
  const cost = parseMoney(form.cost);
  const sell = parseMoney(form.salePrice) ?? parseMoney(form.price);
  const profitHint =
    data.isOwner && typeof cost === "number" && !Number.isNaN(cost) && typeof sell === "number" && !Number.isNaN(sell) && sell > 0
      ? sell - cost >= 0
        ? fill(f.profit, { profit: formatPrice(sell - cost), margin: Math.round(((sell - cost) / sell) * 100) })
        : fill(f.profitNegative, { loss: formatPrice(cost - sell) })
      : null;

  const ownPrices = Object.values(form.cells).some((c) => c.price.trim() !== "");
  const changed = structureChanged(form, savedForm);
  const collections = [...new Set([...data.collections, ...(form.collection ? [form.collection] : [])])];
  const categories = [...new Set([...data.categories, ...form.categories])];

  return (
    <div className="flex flex-col gap-5 pb-24 md:pb-0">
      <Link href="/dashboard/inventory" className="inline-flex min-h-11 w-fit items-center font-semibold text-bo-accent">
        ← {f.back}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-bo-heading text-2xl font-semibold md:text-3xl">{isNew ? f.newTitle : f.editTitle}</h1>
        {dirty && <span className="rounded-full bg-bo-attention-bg px-2.5 py-1 text-xs font-semibold text-bo-attention-text">{f.unsaved}</span>}
        {flash && <span role="status" className="rounded-full bg-status-paid-bg px-2.5 py-1 text-xs font-semibold text-status-paid-fg">{flash}</span>}
      </div>
      {warning && <Note tone="warning">{warning}</Note>}
      {duplicated && <Note tone="warning">{f.duplicateNote}</Note>}

      {/* ---------- Basics ---------- */}
      <Card title={f.basics}>
        <TextField label={f.name} value={form.name} onChange={(v) => set("name", v)} error={errors.name} max={200} />
        <div className="grid gap-5 md:grid-cols-2">
          <TextField label={f.price} value={form.price} onChange={(v) => set("price", v)} error={errors.price} inputMode="decimal" prefix="$" />
          <TextField label={f.salePrice} hint={f.salePriceHint} value={form.salePrice} onChange={(v) => set("salePrice", v)} error={errors.salePrice} inputMode="decimal" prefix="$" />
        </div>
        <TextField label={f.code} hint={f.codeHint} value={form.code} onChange={(v) => set("code", v)} error={errors.code} />
        <TextField label={f.description} value={form.description} onChange={(v) => set("description", v)} error={errors.description} multiline rows={4} max={5000} />

        {/* Collection: pick one, or type a new one */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="collection" className="text-sm font-semibold">{t.backoffice.inventory.collection}</label>
          {newCollection === null ? (
            <select
              id="collection"
              value={form.collection}
              onChange={(e) => (e.target.value === "__new" ? setNewCollection("") : set("collection", e.target.value))}
              className={inputClass}
            >
              <option value="">{f.collectionNone}</option>
              {collections.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="__new">{f.collectionNew}</option>
            </select>
          ) : (
            <div className="flex gap-2">
              <input
                id="collection"
                autoFocus
                maxLength={50}
                placeholder={f.collectionNewPlaceholder}
                value={newCollection}
                onChange={(e) => setNewCollection(e.target.value)}
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  if (newCollection.trim()) set("collection", newCollection.trim());
                  setNewCollection(null);
                }}
              >
                {f.categoryAdd}
              </button>
            </div>
          )}
          {errors.collection && <p className="text-sm font-medium text-status-refused-fg">{errors.collection}</p>}
        </div>

        {/* Categories: tick several, or add a new one */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{f.categories}</legend>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const on = form.categories.includes(c);
              return (
                <label key={c} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm ${on ? "border-bo-accent bg-bo-accent/10 font-semibold" : "border-bo-border bg-white"}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() => set("categories", on ? form.categories.filter((x) => x !== c) : [...form.categories, c])}
                  />
                  {on ? "✓ " : ""}
                  {c}
                </label>
              );
            })}
          </div>
          <div className="flex gap-2">
            <input
              aria-label={f.categoryNewPlaceholder}
              placeholder={f.categoryNewPlaceholder}
              maxLength={50}
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const c = newCategory.trim();
                  if (c && !form.categories.some((x) => x.toLowerCase() === c.toLowerCase())) set("categories", [...form.categories, c]);
                  setNewCategory("");
                }
              }}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                const c = newCategory.trim();
                if (c && !form.categories.some((x) => x.toLowerCase() === c.toLowerCase())) set("categories", [...form.categories, c]);
                setNewCategory("");
              }}
            >
              {f.categoryAdd}
            </button>
          </div>
          {errors.categories && <p className="text-sm font-medium text-status-refused-fg">{errors.categories}</p>}
        </fieldset>

        <Toggle label={f.showOnSite} hint={f.showOnSiteHint} checked={form.isActive} onChange={(v) => set("isActive", v)} />

        <div className="rounded-xl border border-bo-border">
          <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} className="flex min-h-11 w-full items-center justify-between px-4 text-sm font-semibold">
            {f.more}
            <span aria-hidden>{moreOpen ? "▴" : "▾"}</span>
          </button>
          {moreOpen && (
            <div className="grid gap-5 border-t border-bo-border p-4 md:grid-cols-2">
              <TextField label={f.brand} value={form.brand} onChange={(v) => set("brand", v)} error={errors.brand} />
              <TextField label={f.expiry} value={form.expiryDate} onChange={(v) => set("expiryDate", v)} type="date" />
              <TextField label={f.barcode} value={form.barcode} onChange={(v) => set("barcode", v)} error={errors.barcode} inputMode="numeric" />
              <TextField label={f.weight} hint={f.weightHint} value={form.weight} onChange={(v) => set("weight", v)} error={errors.weight} />
            </div>
          )}
        </div>

        {data.isOwner && (
          <div className="flex flex-col gap-1.5">
            <TextField label={f.cost} hint={f.costHint} value={form.cost} onChange={(v) => set("cost", v)} error={errors.cost} inputMode="decimal" prefix="$" className="max-w-48" />
            {profitHint && <p className="text-sm font-semibold text-bo-ink">{profitHint}</p>}
          </div>
        )}
      </Card>

      {/* ---------- Photos ---------- */}
      <Card title={f.photos}>
        <PhotosEditor
          shopId={data.shopId}
          productId={form.id}
          isNew={isNew}
          saved={photos}
          pending={pending}
          onPending={setPending}
          onSavedChange={setPhotos}
          onAdded={(keys) => setAdjustQueue({ keys, total: keys.length })}
          onAdjust={(key) => setAdjustQueue({ keys: [key], total: 1 })}
          onView={setViewIndex}
          max={data.maxPhotos}
        />
        {adjusting && (
          <AdjustPhotoDialog
            key={adjusting.key}
            src={adjusting.url}
            initial={adjusting.focus}
            step={{ n: adjustQueue.total - adjustQueue.keys.length + 1, of: adjustQueue.total }}
            saving={adjustSaving}
            onSave={(focus) => saveFocus(adjusting.key, focus)}
            onSkip={adjustQueue.total > 1 ? nextAdjust : undefined}
            onCancel={() => setAdjustQueue({ keys: [], total: 0 })}
          />
        )}
        {viewIndex !== null && shown.length > 0 && (
          <PhotoViewer
            photos={shown.map((p, i) => ({ url: p.url, alt: fill(inv.photos.alt, { n: i + 1 }) }))}
            start={Math.min(viewIndex, shown.length - 1)}
            onClose={() => setViewIndex(null)}
          />
        )}
      </Card>

      {/* ---------- Options + stock ---------- */}
      <Card title={o.title} intro={o.intro}>
        <OptionsEditor
          form={form}
          setForm={setForm}
          presets={data.presets}
          errors={errors}
          orderedValueIds={new Set(orderedValueIds)}
          photos={photoChoices}
          onUploadForValue={uploadForValue}
          onNote={setNote}
        />
      </Card>

      <Card title={f.stockSection}>
        {(changed || note) && (
          <Note tone="warning">
            {o.structureChanged} {note?.text}
          </Note>
        )}
        {ownPrices && parseMoney(form.salePrice) !== null && <Note tone="warning">{o.saleWarning}</Note>}
        <StockGrid form={form} setForm={setForm} errors={errors} />
        {item && !changed && (
          <details className="rounded-xl border border-bo-border p-3">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">{inv.quickStock}</summary>
            <div className="pt-2">
              <QuickStock item={item} onChanged={onQuickStock} />
            </div>
          </details>
        )}
      </Card>

      {/* ---------- Buttons ---------- */}
      <div className="sticky bottom-16 z-10 -mx-4 flex flex-col gap-2 border-t border-bo-border bg-bo-page/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-bo-card md:border">
        {error && <p role="alert" className="rounded-xl bg-status-refused-bg p-3 text-sm text-status-refused-fg">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButton} disabled={busy || (!dirty && !isNew)} onClick={() => save(false)}>
            {busy ? f.saving : f.save}
          </button>
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => save(true)}>{f.saveAndAdd}</button>
          {item && (
            <>
              <Link href={`/dashboard/inventory/new?from=${item.id}`} className={secondaryButton}>{f.duplicate}</Link>
              <button type="button" className={secondaryButton} disabled={busy || dirty} onClick={toggleVisibility}>
                {item.isActive ? f.hide : f.show}
              </button>
              {data.isOwner && (
                <button
                  type="button"
                  className={dangerButton}
                  disabled={busy}
                  onClick={() => (orderCount > 0 ? setDeleting(true) : window.confirm(fill(f.deleteConfirm, { name: item.name })) && doDelete())}
                >
                  {f.delete}
                </button>
              )}
            </>
          )}
        </div>
        {deleting && item && (
          <div role="alertdialog" className="flex flex-col gap-2 rounded-xl border border-status-refused-fg/30 bg-white p-3">
            <p className="text-sm">{fill(f.deleteInOrders, { name: item.name, count: orderCount })}</p>
            <div className="flex flex-wrap gap-2">
              {item.isActive && (
                <button type="button" className={primaryButton} onClick={() => { setDeleting(false); toggleVisibility(); }}>{f.hideInstead}</button>
              )}
              <button type="button" className={dangerButton} onClick={doDelete}>{f.deleteAnyway}</button>
              <button type="button" className={secondaryButton} onClick={() => setDeleting(false)}>{f.cancel}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
