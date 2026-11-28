"use client";

import { useRef, useState } from "react";
import { fill, t } from "@/lib/i18n";
import {
  addType,
  cellKey,
  cellOf,
  combos,
  newKey,
  removeType,
  type Cell,
  type FormValue,
  type ItemForm,
  type PhotoRef,
  type StructureNote,
} from "@/lib/inventory/form";
import { smartSizeSort } from "@/lib/settings/size-order";
import { dangerButton, inputClass, Note, secondaryButton } from "@/components/backoffice/settings/kit";

const o = t.backoffice.inventory.options;
const f = t.backoffice.inventory.form;

export type PhotoChoice = { ref: Exclude<PhotoRef, null>; url: string; label: string };

const iconBtn =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-bo-border bg-white text-bo-ink hover:bg-bo-page disabled:opacity-40";
const smallInput =
  "h-11 w-full min-w-0 rounded-xl border border-bo-border bg-white px-3 text-base tabular-nums outline-none focus:border-bo-accent focus:ring-2 focus:ring-bo-accent/25 aria-[invalid=true]:border-status-refused-fg";

const sameRef = (a: PhotoRef, b: PhotoRef) =>
  !!a && !!b && a.kind === b.kind && (a.kind === "saved" ? a.id === (b as { id: string }).id : a.localId === (b as { localId: string }).localId);
const refValue = (r: PhotoRef) => (r ? `${r.kind}:${r.kind === "saved" ? r.id : r.localId}` : "");

/** Option types + values (with a photo each). */
export function OptionsEditor({
  form,
  setForm,
  presets,
  errors,
  orderedValueIds,
  photos,
  onUploadForValue,
  onNote,
}: {
  form: ItemForm;
  setForm: (f: ItemForm) => void;
  presets: { name: string; values: string[] }[];
  errors: Record<string, string>;
  orderedValueIds: Set<string>;
  photos: PhotoChoice[];
  onUploadForValue: (typeIndex: number, valueKey: string, file: File) => void;
  onNote: (n: StructureNote) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const [customValues, setCustomValues] = useState("");
  const parsedValues = [...new Map(customValues.split(",").map((x) => x.trim()).filter(Boolean).map((x) => [x.toLowerCase(), x.slice(0, 100)])).values()];
  const canAddCustom = custom.trim().length > 0 && parsedValues.length > 0;
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const usedNames = new Set(form.types.map((ty) => ty.name.trim().toLowerCase()));

  function add(name: string, values: string[]) {
    const r = addType(form, name, values);
    setForm(r.form);
    onNote(r.note);
    setAdding(false);
    setCustom("");
    setCustomValues("");
  }

  function setValues(i: number, values: FormValue[]) {
    const types = form.types.map((ty, j) => (j === i ? { ...ty, values } : ty));
    // Drop stock boxes of removed values.
    const keys = new Set(types.flatMap((ty) => ty.values.map((v) => v.key)));
    const cells = Object.fromEntries(Object.entries(form.cells).filter(([k]) => k.split("|").every((x) => keys.has(x))));
    setForm({ ...form, types, cells });
  }

  function removeValue(i: number, v: FormValue) {
    const hasStock = Object.entries(form.cells).some(([k, c]) => k.split("|").includes(v.key) && /^[1-9]\d*$/.test(c.stock.trim()));
    if ((hasStock || (v.id && orderedValueIds.has(v.id))) && !window.confirm(fill(o.confirmRemoveValue, { value: v.value }))) return;
    setValues(i, form.types[i].values.filter((x) => x.key !== v.key));
  }

  function addValue(i: number) {
    const text = (drafts[form.types[i].key] ?? "").trim();
    if (!text) return;
    if (form.types[i].values.some((v) => v.value.trim().toLowerCase() === text.toLowerCase())) return;
    setValues(i, [...form.types[i].values, { key: newKey(), id: null, value: text, photo: null }]);
    setDrafts({ ...drafts, [form.types[i].key]: "" });
  }

  function moveValue(i: number, k: number, by: -1 | 1) {
    const list = [...form.types[i].values];
    const j = k + by;
    if (j < 0 || j >= list.length) return;
    [list[k], list[j]] = [list[j], list[k]];
    setValues(i, list);
  }

  function smartSort(i: number) {
    const list = form.types[i].values;
    const order = smartSizeSort(list.map((v) => v.value));
    const used = new Set<string>();
    setValues(
      i,
      order.map((name) => {
        const v = list.find((x) => x.value === name && !used.has(x.key))!;
        used.add(v.key);
        return v;
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {form.types.map((ty, i) => (
        <div key={ty.key} className="flex flex-col gap-3 rounded-xl border border-bo-border p-4">
          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor={`type-${ty.key}`} className="text-sm font-semibold">{o.typeName}</label>
              <input
                id={`type-${ty.key}`}
                value={ty.name}
                maxLength={60}
                onChange={(e) => setForm({ ...form, types: form.types.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                className={inputClass}
                aria-invalid={!!errors[`type:${i}:name`]}
              />
            </div>
            <button
              type="button"
              className={dangerButton}
              aria-label={fill(o.removeType, { name: ty.name || o.typeName })}
              onClick={() => {
                if (!window.confirm(fill(o.confirmRemoveType, { name: ty.name }))) return;
                const r = removeType(form, i);
                setForm(r.form);
                onNote(r.note);
              }}
            >
              ✕
            </button>
          </div>
          {errors[`type:${i}:name`] && <p className="text-sm font-medium text-status-refused-fg">{errors[`type:${i}:name`]}</p>}

          <span className="text-sm font-semibold">{o.values}</span>
          <ul className="flex flex-col gap-2">
            {ty.values.map((v, k) => {
              const chosen = photos.find((p) => sameRef(p.ref, v.photo));
              return (
                <li key={v.key} className="flex flex-wrap items-center gap-2 rounded-xl bg-bo-page p-2">
                  <input
                    aria-label={fill(o.renameValue, { value: v.value })}
                    value={v.value}
                    maxLength={100}
                    onChange={(e) => setValues(i, ty.values.map((x) => (x.key === v.key ? { ...x, value: e.target.value } : x)))}
                    className={`${smallInput} flex-1 basis-32`}
                  />
                  <span className="flex gap-1">
                    <button type="button" className={iconBtn} aria-label={fill(o.moveUp, { value: v.value })} disabled={k === 0} onClick={() => moveValue(i, k, -1)}>↑</button>
                    <button type="button" className={iconBtn} aria-label={fill(o.moveDown, { value: v.value })} disabled={k === ty.values.length - 1} onClick={() => moveValue(i, k, 1)}>↓</button>
                  </span>
                  <ValuePhoto
                    value={v}
                    chosen={chosen ?? null}
                    photos={photos}
                    onPick={(ref) => setValues(i, ty.values.map((x) => (x.key === v.key ? { ...x, photo: ref } : x)))}
                    onUpload={(file) => onUploadForValue(i, v.key, file)}
                  />
                  <button type="button" className={iconBtn} aria-label={fill(o.removeValue, { value: v.value })} onClick={() => removeValue(i, v)}>
                    <span className="text-status-refused-fg">✕</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {errors[`type:${i}:values`] && <p className="text-sm font-medium text-status-refused-fg">{errors[`type:${i}:values`]}</p>}
          <div className="flex flex-wrap gap-2">
            <input
              aria-label={`${o.addValue}: ${ty.name}`}
              placeholder={o.valuePlaceholder}
              value={drafts[ty.key] ?? ""}
              maxLength={100}
              onChange={(e) => setDrafts({ ...drafts, [ty.key]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addValue(i);
                }
              }}
              className={`${inputClass} min-w-0 flex-1 basis-40`}
            />
            <button type="button" className={secondaryButton} onClick={() => addValue(i)}>{o.addValue}</button>
            <button type="button" className={secondaryButton} onClick={() => smartSort(i)}>{o.smartSort}</button>
          </div>
        </div>
      ))}

      {form.types.length < 2 &&
        (adding ? (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-bo-border p-4">
            {presets.filter((p) => !usedNames.has(p.name.toLowerCase())).length > 0 && (
              <>
                <span className="text-sm font-semibold">{o.favourites}</span>
                <div className="flex flex-wrap gap-2">
                  {presets
                    .filter((p) => !usedNames.has(p.name.toLowerCase()))
                    .map((p) => (
                      <button key={p.name} type="button" className={secondaryButton} onClick={() => add(p.name, p.values)}>
                        {p.name}
                        <span className="ml-1.5 font-normal text-bo-muted">{p.values.slice(0, 4).join(", ")}{p.values.length > 4 ? "…" : ""}</span>
                      </button>
                    ))}
                </div>
              </>
            )}
            <span className="text-sm font-semibold">{o.custom}</span>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label={o.custom}
                placeholder={o.customPlaceholder}
                value={custom}
                maxLength={50}
                onChange={(e) => setCustom(e.target.value)}
                className={`${inputClass} min-w-0 flex-1 basis-40`}
              />
              <input
                aria-label={o.customValues}
                placeholder={o.customValuesPlaceholder}
                value={customValues}
                onChange={(e) => setCustomValues(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canAddCustom) {
                    e.preventDefault();
                    add(custom.trim(), parsedValues.slice(0, 50));
                  }
                }}
                className={`${inputClass} min-w-0 flex-1 basis-40`}
              />
              <button type="button" className={secondaryButton} disabled={!canAddCustom} onClick={() => add(custom.trim(), parsedValues.slice(0, 50))}>{o.addCustom}</button>
              <button type="button" className={secondaryButton} onClick={() => setAdding(false)}>{f.cancel}</button>
            </div>
          </div>
        ) : (
          <button type="button" className={`${secondaryButton} w-fit`} onClick={() => setAdding(true)}>+ {o.add}</button>
        ))}
    </div>
  );
}

function ValuePhoto({
  value,
  chosen,
  photos,
  onPick,
  onUpload,
}: {
  value: FormValue;
  chosen: PhotoChoice | null;
  photos: PhotoChoice[];
  onPick: (ref: PhotoRef) => void;
  onUpload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-bo-border bg-white">
        {chosen && (
          // eslint-disable-next-line @next/next/no-img-element -- preview
          <img src={chosen.url} alt="" className="h-full w-full object-cover" />
        )}
      </span>
      <select
        aria-label={fill(o.valuePhotoFor, { value: value.value })}
        value={refValue(value.photo)}
        onChange={(e) => onPick(photos.find((p) => refValue(p.ref) === e.target.value)?.ref ?? null)}
        className="h-11 rounded-xl border border-bo-border bg-white px-2 text-sm"
      >
        <option value="">{o.noPhoto}</option>
        {photos.map((p) => (
          <option key={refValue(p.ref)} value={refValue(p.ref)}>{p.label}</option>
        ))}
      </select>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
      <button type="button" className="inline-flex min-h-11 items-center rounded-xl border border-bo-border bg-white px-2.5 text-xs font-semibold hover:bg-bo-page" onClick={() => input.current?.click()}>
        {o.uploadForValue}
      </button>
    </span>
  );
}

/** Stock boxes: one, one per value, or a grid (type 1 rows × type 2 columns). */
export function StockGrid({
  form,
  setForm,
  errors,
}: {
  form: ItemForm;
  setForm: (f: ItemForm) => void;
  errors: Record<string, string>;
}) {
  const anyPrice = Object.values(form.cells).some((c) => c.price.trim() !== "");
  const [showPrices, setShowPrices] = useState(anyPrice);
  const setCell = (key: string, patch: Partial<Cell>) =>
    setForm({ ...form, cells: { ...form.cells, [key]: { ...cellOf(form, key), ...patch } } });

  if (form.types.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor="stock-single" className="text-sm font-semibold">{f.stockBox}</label>
        <input
          id="stock-single"
          inputMode="numeric"
          value={form.stock}
          placeholder="—"
          onChange={(e) => setForm({ ...form, stock: e.target.value })}
          className={`${smallInput} max-w-40`}
          aria-invalid={!!errors.stock}
          aria-describedby="stock-help"
        />
        <p id="stock-help" className="text-sm text-bo-muted">{f.stockHelp}</p>
        {errors.stock && <p className="text-sm font-medium text-status-refused-fg">{errors.stock}</p>}
      </div>
    );
  }

  const [a, b] = form.types;
  const priceToggle = (
    <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
      <input type="checkbox" checked={showPrices || anyPrice} disabled={anyPrice} onChange={(e) => setShowPrices(e.target.checked)} className="h-5 w-5 accent-bo-accent" />
      {o.ownPrice} — <span className="font-normal text-bo-muted">{o.ownPriceHint}</span>
    </label>
  );
  const prices = showPrices || anyPrice;
  const err = (key: string) => errors[`cell:${key}:stock`] ?? errors[`cell:${key}:price`];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{o.stockGrid}</span>
      <p className="text-sm text-bo-muted">{f.stockHelp}</p>
      {priceToggle}
      {!b ? (
        <ul className="flex flex-col gap-2">
          {a.values.map((v) => {
            const key = cellKey(v.key);
            const cell = cellOf(form, key);
            return (
              <li key={key} className="flex flex-wrap items-center gap-2">
                <span className="min-w-24 flex-1 text-sm font-medium">{v.value || "…"}</span>
                <input aria-label={`${f.stockBox}: ${v.value}`} inputMode="numeric" placeholder="—" value={cell.stock}
                  onChange={(e) => setCell(key, { stock: e.target.value })} className={`${smallInput} w-24`}
                  aria-invalid={!!errors[`cell:${key}:stock`]} />
                {prices && (
                  <span className="flex items-center gap-1">
                    <span className="text-bo-muted">$</span>
                    <input aria-label={`${o.ownPrice}: ${v.value}`} inputMode="decimal" placeholder="—" value={cell.price}
                      onChange={(e) => setCell(key, { price: e.target.value })} className={`${smallInput} w-24`}
                      aria-invalid={!!errors[`cell:${key}:price`]} />
                  </span>
                )}
                {err(key) && <p className="w-full text-sm font-medium text-status-refused-fg">{err(key)}</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-1 text-left text-bo-muted">{a.name} \ {b.name}</th>
                {b.values.map((v2) => (
                  <th key={v2.key} scope="col" className="min-w-20 px-1 text-left font-semibold">{v2.value || "…"}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.values.map((v1) => (
                <tr key={v1.key}>
                  <th scope="row" className="whitespace-nowrap px-1 text-left font-semibold">{v1.value || "…"}</th>
                  {b.values.map((v2) => {
                    const key = cellKey(v1.key, v2.key);
                    const cell = cellOf(form, key);
                    return (
                      <td key={key} className="align-top">
                        <input aria-label={`${f.stockBox}: ${v1.value} / ${v2.value}`} inputMode="numeric" placeholder="—" value={cell.stock}
                          onChange={(e) => setCell(key, { stock: e.target.value })} className={`${smallInput} w-20`}
                          aria-invalid={!!errors[`cell:${key}:stock`]} />
                        {prices && (
                          <input aria-label={`${o.ownPrice}: ${v1.value} / ${v2.value}`} inputMode="decimal" placeholder="$" value={cell.price}
                            onChange={(e) => setCell(key, { price: e.target.value })} className={`${smallInput} mt-1 w-20`}
                            aria-invalid={!!errors[`cell:${key}:price`]} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {combos(form).some((c) => err(c.key)) && <p className="text-sm font-medium text-status-refused-fg">{f.errors.stock}</p>}
        </div>
      )}
    </div>
  );
}

export { Note };
