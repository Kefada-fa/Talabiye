"use server";

import { refresh } from "next/cache";
import { t } from "@/lib/i18n";
import { getDashboardContext } from "@/lib/backoffice/context";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_PHOTOS_BUCKET } from "@/lib/storefront/photos";
import { validatePayload } from "@/lib/inventory/form";
import type { ActionResult } from "@/lib/inventory/types";

/*
 * Every action finds the CURRENT shop on the server (never trusts a shop id
 * from the browser), checks membership (owners for delete / costs), checks
 * the input, and works with the user's own session — the database (RLS,
 * functions, checks) blocks the rest a second time.
 */
const f = t.backoffice.inventory.form;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Member = { supabase: Awaited<ReturnType<typeof createClient>>; shopId: string; isOwner: boolean };

async function requireMember(): Promise<Member | null> {
  const ctx = await getDashboardContext();
  if (!ctx.current) return null;
  return { supabase: await createClient(), shopId: ctx.current.id, isOwner: ctx.current.role === "owner" };
}

const fail = (error: string): ActionResult<never> => ({ ok: false, error });

/** Friendly text for a database error. */
function dbError(error: { code?: string; message: string }): ActionResult<never> {
  console.error("[inventory]", error.code, error.message);
  if (error.code === "42501") return fail(/owner/i.test(error.message) ? f.errors.notOwner : f.errors.generic);
  if (/products_shop_code_key/.test(error.message)) return fail(f.errors.codeTaken);
  if (/products_sale_price_check/.test(error.message)) return fail(f.errors.salePrice);
  if (error.code === "P0002") return fail(f.errors.notFound);
  // Our own function messages are written for people.
  if (!/violates|duplicate key|syntax|invalid input/i.test(error.message)) return fail(error.message);
  return fail(f.errors.generic);
}

/** Is this product in the current shop? */
async function ownProduct(m: Member, productId: string): Promise<boolean> {
  if (typeof productId !== "string" || !UUID_RE.test(productId)) return false;
  const { data } = await m.supabase.from("products").select("id").eq("id", productId).eq("shop_id", m.shopId).maybeSingle();
  return !!data;
}

// ------------------------------------------------------------- save item
export async function saveItemAction(
  productId: string | null,
  payload: Record<string, unknown>,
): Promise<ActionResult<{ productId: string; valueIds: Record<string, string> }>> {
  const m = await requireMember();
  if (!m) return fail(f.errors.generic);
  if (productId !== null && (typeof productId !== "string" || !UUID_RE.test(productId))) return fail(f.errors.notFound);

  const data = { ...(payload ?? {}) };
  if (!m.isOwner) delete data.cost; // staff never touch costs (the database refuses too)
  if (productId === null && data.id !== undefined && (typeof data.id !== "string" || !UUID_RE.test(data.id))) return fail(f.errors.generic);
  const problem = validatePayload(data);
  if (problem) return fail(problem);

  const { data: res, error } = await m.supabase.rpc("save_product", {
    p_shop_id: m.shopId,
    p_product_id: productId,
    p_data: data,
  });
  if (error) return dbError(error);
  const r = res as { product_id: string; value_ids: Record<string, string> };
  refresh();
  return { ok: true, productId: r.product_id, valueIds: r.value_ids ?? {} };
}

// ------------------------------------------------------------ visibility
export async function setVisibilityAction(productId: string, visible: boolean): Promise<ActionResult> {
  const m = await requireMember();
  if (!m || !(await ownProduct(m, productId))) return fail(f.errors.notFound);
  const { error } = await m.supabase.from("products").update({ is_active: visible === true }).eq("id", productId);
  if (error) return dbError(error);
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------- delete
/** Owners only. Order lines keep their copies (name, price, photo). */
export async function deleteItemAction(productId: string): Promise<ActionResult> {
  const m = await requireMember();
  if (!m) return fail(f.errors.generic);
  if (!m.isOwner) return fail(f.errors.notOwner);
  if (!(await ownProduct(m, productId))) return fail(f.errors.notFound);

  // Delete the files FIRST: the storage rules only allow it while the item
  // still exists. Photos that past orders still show are kept.
  const { data: photos } = await m.supabase.from("product_photos").select("storage_path").eq("product_id", productId);
  const paths = (photos ?? []).map((p) => p.storage_path as string).filter((p) => !/^https?:\/\//.test(p));
  if (paths.length > 0) {
    const { data: used } = await m.supabase.from("order_items").select("photo").in("photo", paths);
    const keep = new Set((used ?? []).map((u) => u.photo as string));
    const remove = paths.filter((p) => !keep.has(p));
    if (remove.length > 0) {
      const { error: rmError } = await m.supabase.storage.from(PRODUCT_PHOTOS_BUCKET).remove(remove);
      if (rmError) console.error("[inventory] could not delete photo files:", rmError.message);
    }
  }

  const { data: deleted, error } = await m.supabase.from("products").delete().eq("id", productId).select("id");
  if (error) return dbError(error);
  if (!deleted || deleted.length === 0) return fail(f.errors.notOwner);
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------ quick stock
export async function changeStockAction(
  productId: string,
  variantId: string | null,
  delta: number | null,
  set: number | null,
): Promise<ActionResult<{ stock: number }>> {
  const m = await requireMember();
  if (!m || !(await ownProduct(m, productId))) return fail(f.errors.notFound);
  if (variantId !== null && !UUID_RE.test(String(variantId))) return fail(f.errors.notFound);
  const okNum = (n: unknown) => n === null || (Number.isInteger(n) && Math.abs(n as number) <= 1000000);
  if (!okNum(delta) || !okNum(set) || (delta === null) === (set === null)) return fail(f.errors.stock);

  const { data, error } = await m.supabase.rpc("change_stock", {
    p_product_id: productId,
    p_variant_id: variantId,
    p_delta: delta,
    p_set: set,
  });
  if (error) return dbError(error);
  return { ok: true, stock: Number(data) };
}

// ----------------------------------------------------------------- photos
/** Saves photo rows for files the browser just uploaded (in order). */
export async function addPhotosAction(productId: string, paths: string[]): Promise<ActionResult<{ photos: { id: string; path: string }[] }>> {
  const m = await requireMember();
  if (!m || !(await ownProduct(m, productId))) return fail(f.errors.notFound);
  const re = new RegExp(`^${m.shopId}/${productId}/[A-Za-z0-9-]{1,64}\\.(webp|jpg|png)$`);
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 50 || !paths.every((p) => typeof p === "string" && re.test(p))) {
    return fail(f.errors.generic);
  }
  const { data: last } = await m.supabase
    .from("product_photos")
    .select("position")
    .eq("product_id", productId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let position = Number(last?.position ?? -1);
  const rows = paths.map((path) => ({ shop_id: m.shopId, product_id: productId, storage_path: path, position: ++position }));
  const { data, error } = await m.supabase.from("product_photos").insert(rows).select("id, storage_path");
  if (error) return dbError(error); // e.g. "An item can have at most 10 photos"
  refresh();
  return { ok: true, photos: (data ?? []).map((r) => ({ id: r.id as string, path: r.storage_path as string })) };
}

/** Removes a photo (row + file, unless a past order still shows it). */
export async function removePhotoAction(photoId: string): Promise<ActionResult> {
  const m = await requireMember();
  if (!m || !UUID_RE.test(String(photoId))) return fail(f.errors.notFound);
  const { data: photo } = await m.supabase
    .from("product_photos")
    .select("id, storage_path")
    .eq("id", photoId)
    .eq("shop_id", m.shopId)
    .maybeSingle();
  if (!photo) return fail(f.errors.notFound);
  const { error } = await m.supabase.from("product_photos").delete().eq("id", photoId);
  if (error) return dbError(error);
  const path = photo.storage_path as string;
  if (!/^https?:\/\//.test(path)) {
    const { data: used } = await m.supabase.from("order_items").select("id").eq("photo", path).limit(1);
    if (!used || used.length === 0) await m.supabase.storage.from(PRODUCT_PHOTOS_BUCKET).remove([path]);
  }
  refresh();
  return { ok: true };
}

/** New order of an item's photos (the first one is the main photo). */
export async function reorderPhotosAction(productId: string, ids: string[]): Promise<ActionResult> {
  const m = await requireMember();
  if (!m || !(await ownProduct(m, productId))) return fail(f.errors.notFound);
  const { data: current } = await m.supabase.from("product_photos").select("id").eq("product_id", productId);
  const known = new Set((current ?? []).map((r) => r.id as string));
  if (!Array.isArray(ids) || ids.length !== known.size || !ids.every((id) => known.has(id))) return fail(f.errors.generic);
  for (const [i, id] of ids.entries()) {
    const { error } = await m.supabase.from("product_photos").update({ position: i }).eq("id", id);
    if (error) return dbError(error);
  }
  refresh();
  return { ok: true };
}

/** Links option values to photos (after new photos were uploaded). */
export async function setValuePhotosAction(productId: string, links: Record<string, string | null>): Promise<ActionResult> {
  const m = await requireMember();
  if (!m || !(await ownProduct(m, productId))) return fail(f.errors.notFound);
  if (!links || typeof links !== "object" || !Object.entries(links).every(([k, v]) => UUID_RE.test(k) && (v === null || UUID_RE.test(v)))) {
    return fail(f.errors.generic);
  }
  const { error } = await m.supabase.rpc("set_value_photos", { p_product_id: productId, p_links: links });
  if (error) return dbError(error);
  refresh();
  return { ok: true };
}
