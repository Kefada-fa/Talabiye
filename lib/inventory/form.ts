/**
 * The item editor's data, and everything that turns it into a
 * save_product() call. Used by the browser (instant checks) and by the
 * server action (validatePayload = the real check, before the database).
 *
 * Stock boxes: "" = not tracked (made to order), "0" = sold out.
 * Each box remembers the stock shown when the page opened ("base"), so the
 * database can keep orders / quick-stock changes made meanwhile.
 */
import { fill, t } from "@/lib/i18n";
import type { InvItem } from "./types";

const f = t.backoffice.inventory.form;
const o = t.backoffice.inventory.options;

export type PhotoRef = { kind: "saved"; id: string } | { kind: "pending"; localId: string } | null;
export type FormValue = { key: string; id: string | null; value: string; photo: PhotoRef };
export type FormType = { key: string; id: string | null; name: string; values: FormValue[] };
export type Cell = { stock: string; price: string; base?: number | null };

export type ItemForm = {
  id: string; // product id (a new item gets its id in the browser)
  isNew: boolean;
  name: string;
  code: string;
  description: string;
  price: string;
  salePrice: string;
  collection: string;
  categories: string[];
  isActive: boolean;
  brand: string;
  expiryDate: string;
  barcode: string;
  weight: string;
  cost: string;
  stock: string; // items without options
  stockBase?: number | null; // undefined = new box (no base)
  types: FormType[];
  cells: Record<string, Cell>;
};

export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));
export const cellKey = (v1: string, v2?: string | null) => (v2 ? `${v1}|${v2}` : v1);
const numText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function emptyForm(id: string): ItemForm {
  return {
    id, isNew: true, name: "", code: "", description: "", price: "", salePrice: "", collection: "",
    categories: [], isActive: true, brand: "", expiryDate: "", barcode: "", weight: "", cost: "",
    stock: "", types: [], cells: {},
  };
}

/** Editor data for an existing item, or for a DUPLICATE (new id, no code,
 *  no photos, all stock boxes empty, no own prices). */
export function formFromItem(item: InvItem, opts: { duplicateAs?: string } = {}): ItemForm {
  const dup = !!opts.duplicateAs;
  const keyOf = new Map<string, string>(); // value id → key
  const types: FormType[] = item.types.map((ty) => ({
    key: dup ? newKey() : ty.id,
    id: dup ? null : ty.id,
    name: ty.name,
    values: ty.values.map((v) => {
      const key = dup ? newKey() : v.id;
      keyOf.set(v.id, key);
      return { key, id: dup ? null : v.id, value: v.value, photo: !dup && v.photoId ? { kind: "saved", id: v.photoId } : null };
    }),
  }));
  const cells: Record<string, Cell> = {};
  if (!dup) {
    for (const v of item.variants) {
      if (!v.value1Id) continue;
      const k = cellKey(keyOf.get(v.value1Id) ?? v.value1Id, v.value2Id ? (keyOf.get(v.value2Id) ?? v.value2Id) : null);
      cells[k] = { stock: numText(v.stock), price: numText(v.price), base: v.stock };
    }
  }
  return {
    id: opts.duplicateAs ?? item.id,
    isNew: dup,
    name: dup ? `${item.name}${f.copySuffix}`.slice(0, 200) : item.name,
    code: dup ? "" : (item.code ?? ""),
    description: item.description ?? "",
    price: String(item.price),
    salePrice: numText(item.salePrice),
    collection: item.collection ?? "",
    categories: item.categories,
    isActive: item.isActive,
    brand: item.brand ?? "",
    expiryDate: item.expiryDate ?? "",
    barcode: item.barcode ?? "",
    weight: item.weight ?? "",
    cost: numText(item.cost),
    stock: dup ? "" : numText(item.stock),
    stockBase: dup || item.types.length > 0 ? undefined : item.stock,
    types,
    cells,
  };
}

// ------------------------------------------------------------ the grid
export type Combo = { key: string; v1: FormValue; v2: FormValue | null };

export function combos(form: ItemForm): Combo[] {
  const [a, b] = form.types;
  if (!a) return [];
  return a.values.flatMap((v1): Combo[] =>
    b ? b.values.map((v2) => ({ key: cellKey(v1.key, v2.key), v1, v2 })) : [{ key: cellKey(v1.key), v1, v2: null }],
  );
}

export const cellOf = (form: ItemForm, key: string): Cell => form.cells[key] ?? { stock: "", price: "" };

/** Adds up stock boxes: numbers are added; all empty → empty (not tracked). */
function sumStock(cells: Cell[]): string {
  const nums = cells.map((c) => c.stock.trim()).filter((s) => /^\d+$/.test(s)).map(Number);
  return nums.length ? String(nums.reduce((x, y) => x + y, 0)) : "";
}
function samePrice(cells: Cell[]): string {
  const prices = new Set(cells.map((c) => c.price.trim()));
  return prices.size === 1 ? [...prices][0] : "";
}

/** What changed in the stock boxes after adding/removing an option type. */
export type StructureNote = { text: string } | null;

/**
 * Adds an option type and KEEPS the stock:
 *  - first type: the item's single stock goes under the first value;
 *  - second type: each old box goes under the first value of the new type
 *    (own prices are copied to all of its combinations).
 */
export function addType(form: ItemForm, name: string, values: string[]): { form: ItemForm; note: StructureNote } {
  const vals: FormValue[] = values.map((v) => ({ key: newKey(), id: null, value: v, photo: null }));
  const type: FormType = { key: newKey(), id: null, name, values: vals };
  if (form.types.length >= 2) return { form, note: null };
  const first = vals[0];

  if (form.types.length === 0) {
    const cells: Record<string, Cell> = {};
    if (first && form.stock.trim() !== "") cells[cellKey(first.key)] = { stock: form.stock, price: "" };
    return {
      form: { ...form, types: [type], cells, stock: "", stockBase: undefined },
      note: first && form.stock.trim() !== "" ? { text: fill(o.movedFromSingle, { value: first.value }) } : null,
    };
  }

  const cells: Record<string, Cell> = {};
  let moved = false;
  for (const v1 of form.types[0].values) {
    const old = cellOf(form, cellKey(v1.key));
    vals.forEach((v2, i) => {
      cells[cellKey(v1.key, v2.key)] = { stock: i === 0 ? old.stock : "", price: old.price };
    });
    if (old.stock.trim() !== "") moved = true;
  }
  return {
    form: { ...form, types: [form.types[0], type], cells },
    note: moved && first ? { text: fill(o.movedToFirst, { value: first.value }) } : null,
  };
}

/** Removes an option type and ADDS UP the stock per remaining value. */
export function removeType(form: ItemForm, index: number): { form: ItemForm; note: StructureNote } {
  if (form.types.length === 1) {
    const all = combos(form).map((c) => cellOf(form, c.key));
    return {
      form: { ...form, types: [], cells: {}, stock: sumStock(all), stockBase: undefined },
      note: { text: o.backToSingle },
    };
  }
  const keep = form.types[index === 0 ? 1 : 0];
  const gone = form.types[index];
  const cells: Record<string, Cell> = {};
  for (const r of keep.values) {
    const related = gone.values.map((g) => cellOf(form, index === 0 ? cellKey(g.key, r.key) : cellKey(r.key, g.key)));
    cells[cellKey(r.key)] = { stock: sumStock(related), price: samePrice(related) };
  }
  return { form: { ...form, types: [keep], cells }, note: { text: o.addedUp } };
}

/** Did the option TYPES change compared with the saved item? */
export function structureChanged(form: ItemForm, saved: ItemForm | null): boolean {
  if (!saved || saved.isNew) return false;
  const ids = (x: ItemForm) => x.types.map((ty) => ty.id ?? "new").join(",");
  return ids(form) !== ids(saved);
}

// ------------------------------------------------------------- checks
export const CODE_RE = /^[A-Za-z0-9._-]{1,50}$/;
const BARCODE_RE = /^[A-Za-z0-9-]{1,64}$/;
const MONEY_RE = /^\d{1,7}(\.\d{1,2})?$/;

export function parseMoney(s: string): number | null | typeof NaN {
  const v = s.trim().replace(",", ".");
  if (!v) return null;
  return MONEY_RE.test(v) ? Number(v) : NaN;
}
export function parseStock(s: string): number | null | typeof NaN {
  const v = s.trim();
  if (!v) return null;
  return /^\d{1,7}$/.test(v) ? Number(v) : NaN;
}

/** Field errors for the editor (keys match the inputs). */
export function validateForm(form: ItemForm, isOwner: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  const name = form.name.trim();
  if (name.length < 1 || name.length > 200) e.name = f.errors.name;
  const price = parseMoney(form.price);
  if (price === null || Number.isNaN(price)) e.price = f.errors.price;
  const sale = parseMoney(form.salePrice);
  if (Number.isNaN(sale)) e.salePrice = f.errors.price;
  else if (sale !== null && price !== null && !Number.isNaN(price) && (sale <= 0 || sale >= price)) e.salePrice = f.errors.salePrice;
  if (form.code.trim() && !CODE_RE.test(form.code.trim())) e.code = f.errors.code;
  if (form.description.length > 5000) e.description = fill(f.errors.tooLong, { max: 5000 });
  if (form.brand.trim().length > 100) e.brand = fill(f.errors.tooLong, { max: 100 });
  if (form.barcode.trim() && !BARCODE_RE.test(form.barcode.trim())) e.barcode = f.errors.code;
  if (form.weight.trim().length > 50) e.weight = fill(f.errors.tooLong, { max: 50 });
  if (form.collection.trim().length > 50) e.collection = f.errors.label;
  if (form.categories.length > 20 || form.categories.some((c) => c.trim().length < 1 || c.trim().length > 50)) e.categories = f.errors.label;
  if (isOwner && Number.isNaN(parseMoney(form.cost))) e.cost = f.errors.cost;

  if (form.types.length === 0) {
    if (Number.isNaN(parseStock(form.stock))) e.stock = f.errors.stock;
  } else {
    if (form.types.length === 2 && form.types[0].name.trim().toLowerCase() === form.types[1].name.trim().toLowerCase())
      e["type:1:name"] = o.errors.duplicateName;
    form.types.forEach((ty, i) => {
      if (ty.name.trim().length < 1 || ty.name.trim().length > 50) e[`type:${i}:name`] = o.errors.name;
      if (ty.values.length === 0) e[`type:${i}:values`] = o.errors.noValues;
      else if (ty.values.length > 50) e[`type:${i}:values`] = o.errors.tooMany;
      else if (ty.values.some((v) => v.value.trim().length < 1 || v.value.trim().length > 100)) e[`type:${i}:values`] = o.errors.value;
      else if (new Set(ty.values.map((v) => v.value.trim().toLowerCase())).size !== ty.values.length)
        e[`type:${i}:values`] = o.errors.duplicateValue;
    });
    for (const c of combos(form)) {
      const cell = cellOf(form, c.key);
      if (Number.isNaN(parseStock(cell.stock))) e[`cell:${c.key}:stock`] = f.errors.stock;
      if (Number.isNaN(parseMoney(cell.price))) e[`cell:${c.key}:price`] = f.errors.optionPrice;
    }
  }
  return e;
}

// ------------------------------------------------------------ the payload
export type SavePayload = Record<string, unknown> & {
  types: { id: string | null; name: string; values: { key: string; id: string | null; value: string; photo_id: string | null }[] }[];
  variants: { v1: string; v2: string | null; stock: number | null; price: number | null; stock_base?: number | null }[];
};

/** The data for save_product(). Staff never send a cost. */
export function buildPayload(form: ItemForm, isOwner: boolean): SavePayload {
  const num = (s: string) => {
    const n = parseMoney(s);
    return n === null || Number.isNaN(n) ? null : n;
  };
  const stock = (s: string) => {
    const n = parseStock(s);
    return n === null || Number.isNaN(n) ? null : n;
  };
  const payload: SavePayload = {
    ...(form.isNew ? { id: form.id } : {}),
    name: form.name.trim(),
    code: form.code.trim(),
    description: form.description.trim(),
    price: num(form.price) ?? 0,
    sale_price: num(form.salePrice),
    collection: form.collection.trim(),
    categories: form.categories.map((c) => c.trim()).filter(Boolean),
    is_active: form.isActive,
    brand: form.brand.trim(),
    expiry_date: form.expiryDate || null,
    barcode: form.barcode.trim(),
    weight: form.weight.trim(),
    types: form.types.map((ty) => ({
      id: ty.id,
      name: ty.name.trim(),
      values: ty.values.map((v) => ({
        key: v.key,
        id: v.id,
        value: v.value.trim(),
        photo_id: v.photo?.kind === "saved" ? v.photo.id : null,
      })),
    })),
    variants: combos(form).map((c) => {
      const cell = cellOf(form, c.key);
      return {
        v1: c.v1.key,
        v2: c.v2?.key ?? null,
        stock: stock(cell.stock),
        price: num(cell.price),
        ...(cell.base !== undefined ? { stock_base: cell.base } : {}),
      };
    }),
  };
  if (form.types.length === 0) {
    payload.stock = stock(form.stock);
    if (form.stockBase !== undefined) payload.stock_base = form.stockBase;
  }
  if (isOwner) payload.cost = num(form.cost);
  return payload;
}

/** Server-side check of a payload (first problem, or null). */
export function validatePayload(p: unknown): string | null {
  if (!p || typeof p !== "object") return f.errors.generic;
  const d = p as Record<string, unknown>;
  const str = (k: string, max: number) => typeof d[k] === "string" && (d[k] as string).length <= max;
  if (!str("name", 200) || !(d.name as string).trim()) return f.errors.name;
  if (typeof d.price !== "number" || d.price < 0 || d.price > 1000000) return f.errors.price;
  if (d.sale_price !== null && (typeof d.sale_price !== "number" || d.sale_price <= 0 || d.sale_price >= d.price))
    return f.errors.salePrice;
  if (!str("code", 50) || ((d.code as string) && !CODE_RE.test(d.code as string))) return f.errors.code;
  if (!str("description", 5000) || !str("brand", 100) || !str("barcode", 64) || !str("weight", 50) || !str("collection", 50))
    return f.errors.fix;
  if (!Array.isArray(d.categories) || d.categories.length > 20 || d.categories.some((c) => typeof c !== "string" || c.length > 50))
    return f.errors.label;
  if (d.expiry_date !== null && (typeof d.expiry_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.expiry_date)))
    return f.errors.fix;
  if (!Array.isArray(d.types) || d.types.length > 2) return o.errors.name;
  if (!Array.isArray(d.variants) || d.variants.length > 2500) return f.errors.fix;
  for (const v of d.variants as Record<string, unknown>[]) {
    if (v.stock !== null && (!Number.isInteger(v.stock) || (v.stock as number) < 0)) return f.errors.stock;
    if (v.price !== null && (typeof v.price !== "number" || v.price < 0)) return f.errors.optionPrice;
  }
  if ("stock" in d && d.stock !== null && (!Number.isInteger(d.stock) || (d.stock as number) < 0)) return f.errors.stock;
  if ("cost" in d && d.cost !== null && (typeof d.cost !== "number" || d.cost < 0)) return f.errors.cost;
  return null;
}
