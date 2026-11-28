"use server";

import { createClient as createPlainClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { fill, t } from "@/lib/i18n";
import { getDashboardContext } from "@/lib/backoffice/context";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { SHOP_ASSETS_BUCKET } from "@/lib/storefront/photos";
import type { SaveResult } from "@/lib/settings/types";
import {
  hasErrors,
  validateDelivery,
  validateDeposits,
  validateLabelName,
  validateLinkPreview,
  validateNotifications,
  validateOrdering,
  validatePasswordChange,
  validatePolicy,
  validatePrefix,
  validatePresets,
  validateProductPage,
  validateProfile,
  validateReviews,
  validateTemplates,
  type FieldErrors,
} from "@/lib/settings/validate";

/*
 * Every action here:
 *   1. finds the logged-in user's CURRENT shop on the server (never trusts
 *      a shop id sent by the browser) and refuses if they're not its OWNER;
 *   2. validates the input with the same rules as the form;
 *   3. saves with the user's own session — the database (RLS + checks)
 *      blocks non-owners and bad values a second time.
 */

const s = t.backoffice.settings;
type Owner = { supabase: Awaited<ReturnType<typeof createClient>>; shopId: string };

async function requireOwner(): Promise<Owner | null> {
  const ctx = await getDashboardContext();
  if (!ctx.current || ctx.current.role !== "owner") return null;
  return { supabase: await createClient(), shopId: ctx.current.id };
}

const NOT_OWNER: SaveResult = { ok: false, error: s.errors.notOwner };
const invalid = (fieldErrors: FieldErrors): SaveResult => ({
  ok: false,
  error: fieldErrors.form ?? s.errors.fixFields,
  fieldErrors,
});

/** Friendly text for a database error (our own function messages are friendly). */
function dbError(error: { code?: string; message: string }): SaveResult {
  console.error("[settings]", error.code, error.message);
  if (error.code === "42501") return NOT_OWNER;
  const own = error.code === "23514" || error.code === "23505" || error.code === "22023";
  if (own && !/violates|duplicate key/i.test(error.message)) return { ok: false, error: error.message };
  return { ok: false, error: s.errors.generic };
}

async function updateTable(
  table: "shops" | "shop_private_settings" | "shop_notification_settings",
  values: Record<string, unknown>,
): Promise<SaveResult> {
  const owner = await requireOwner();
  if (!owner) return NOT_OWNER;
  const { supabase, shopId } = owner;
  const query = supabase.from(table).update(values);
  const { data, error } = await (table === "shops" ? query.eq("id", shopId) : query.eq("shop_id", shopId)).select("id");
  if (error) return dbError(error);
  if (!data || data.length === 0) return NOT_OWNER; // RLS changed nothing
  refresh();
  return { ok: true };
}

function validated<T extends Record<string, unknown>>(r: { value: T; errors: FieldErrors }) {
  return hasErrors(r.errors) ? null : r.value;
}

// ------------------------------------------------------------- sections
export async function saveProfileAction(input: unknown): Promise<SaveResult> {
  const r = validateProfile((input ?? {}) as never);
  const v = validated(r);
  return v ? updateTable("shops", v) : invalid(r.errors);
}

export async function saveLinkPreviewAction(input: unknown): Promise<SaveResult> {
  const r = validateLinkPreview((input ?? {}) as never);
  const v = validated(r);
  return v ? updateTable("shops", v) : invalid(r.errors);
}

export async function saveOrderingAction(input: unknown): Promise<SaveResult> {
  const r = validateOrdering((input ?? {}) as never);
  const v = validated(r);
  return v ? updateTable("shops", v) : invalid(r.errors);
}

export async function saveProductPageAction(input: unknown): Promise<SaveResult> {
  const r = validateProductPage((input ?? {}) as never);
  const v = validated(r);
  return v ? updateTable("shops", v) : invalid(r.errors);
}

export async function savePolicyAction(input: unknown): Promise<SaveResult> {
  const r = validatePolicy((input ?? {}) as never);
  const v = validated(r);
  return v ? updateTable("shops", v) : invalid(r.errors);
}

export async function saveReviewsAction(input: unknown): Promise<SaveResult> {
  const r = validateReviews((input ?? {}) as never);
  return updateTable("shops", r.value);
}

export async function saveDepositsAction(input: unknown): Promise<SaveResult> {
  const r = validateDeposits((input ?? {}) as never);
  const v = validated(r);
  return v ? updateTable("shop_private_settings", v) : invalid(r.errors);
}

export async function saveTemplatesAction(input: unknown): Promise<SaveResult> {
  const r = validateTemplates((input ?? {}) as never);
  const v = validated(r);
  return v ? updateTable("shop_private_settings", v) : invalid(r.errors);
}

export async function savePrefixAction(input: unknown): Promise<SaveResult> {
  const r = validatePrefix((input ?? {}) as never);
  const v = validated(r);
  return v ? updateTable("shop_private_settings", v) : invalid(r.errors);
}

export async function saveNotificationsAction(input: unknown): Promise<SaveResult> {
  const r = validateNotifications((input ?? {}) as never);
  const v = validated(r);
  return v ? updateTable("shop_notification_settings", v) : invalid(r.errors);
}

export async function saveDeliveryAction(input: unknown): Promise<SaveResult> {
  const owner = await requireOwner();
  if (!owner) return NOT_OWNER;
  const { supabase, shopId } = owner;
  const { data: govs } = await supabase.from("lebanon_governorates").select("name");
  const r = validateDelivery((input ?? {}) as never, (govs ?? []).map((g) => g.name as string));
  if (hasErrors(r.errors)) return invalid(r.errors);

  const { error } = await supabase.rpc("save_delivery_settings", { p_shop_id: shopId, ...r.value });
  if (error) return dbError(error);
  refresh();
  return { ok: true };
}

// ------------------------------------------------------- logo + share image
const ASSET_FIELDS = { logo: "logo_path", share: "share_image_path" } as const;

/** Saves the path of a picture the browser just uploaded (or null = remove). */
export async function saveShopImageAction(kind: "logo" | "share", path: string | null): Promise<SaveResult> {
  if (kind !== "logo" && kind !== "share") return { ok: false, error: s.errors.generic };
  const owner = await requireOwner();
  if (!owner) return NOT_OWNER;
  const { supabase, shopId } = owner;

  // Only a file in THIS shop's folder, with a name we create.
  const re = new RegExp(`^${shopId}/${kind}-[A-Za-z0-9-]{1,64}\\.(webp|jpg|png)$`);
  if (path !== null && (typeof path !== "string" || !re.test(path))) return { ok: false, error: s.errors.generic };

  const field = ASSET_FIELDS[kind];
  const { data: before } = await supabase.from("shops").select(field).eq("id", shopId).maybeSingle();
  const oldPath = (before as Record<string, string | null> | null)?.[field] ?? null;

  const { data, error } = await supabase.from("shops").update({ [field]: path }).eq("id", shopId).select("id");
  if (error) return dbError(error);
  if (!data || data.length === 0) return NOT_OWNER;

  // Remove the old file (storage rules: only owners of this shop can).
  if (oldPath && oldPath !== path) {
    const { error: rmError } = await supabase.storage.from(SHOP_ASSETS_BUCKET).remove([oldPath]);
    if (rmError) console.error("[settings] could not remove old picture:", rmError.message);
  }
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------ catalog lists
async function labelsOf(owner: Owner, kind: string) {
  const { data } = await owner.supabase
    .from("shop_catalog_labels")
    .select("id, name, position")
    .eq("shop_id", owner.shopId)
    .eq("kind", kind)
    .order("position");
  return (data ?? []) as { id: string; name: string; position: number }[];
}

export async function addLabelAction(kind: "collection" | "category", name: string): Promise<SaveResult> {
  if (kind !== "collection" && kind !== "category") return { ok: false, error: s.errors.generic };
  const owner = await requireOwner();
  if (!owner) return NOT_OWNER;
  const existing = await labelsOf(owner, kind);
  const problem = validateLabelName(String(name ?? ""), existing.map((l) => l.name));
  if (problem) return { ok: false, error: problem };

  const position = existing.reduce((max, l) => Math.max(max, l.position), 0) + 1;
  const { error } = await owner.supabase
    .from("shop_catalog_labels")
    .insert({ shop_id: owner.shopId, kind, name: String(name).trim(), position });
  if (error) return error.code === "23505" ? { ok: false, error: s.lists.errors.duplicate } : dbError(error);
  refresh();
  return { ok: true };
}

export async function renameLabelAction(id: string, name: string): Promise<SaveResult> {
  const owner = await requireOwner();
  if (!owner) return NOT_OWNER;
  const problem = validateLabelName(String(name ?? ""), []);
  if (problem) return { ok: false, error: problem };
  // The function re-checks that this label belongs to a shop the user owns.
  const { data, error } = await owner.supabase.rpc("rename_catalog_label", { p_label_id: id, p_new_name: name });
  if (error) return error.code === "23505" ? { ok: false, error: s.lists.errors.duplicate } : dbError(error);
  refresh();
  const count = Number(data ?? 0);
  return { ok: true, message: count === 1 ? s.lists.renamedOne : fill(s.lists.renamed, { count }) };
}

export async function deleteLabelAction(id: string): Promise<SaveResult> {
  const owner = await requireOwner();
  if (!owner) return NOT_OWNER;
  const { error } = await owner.supabase.rpc("delete_catalog_label", { p_label_id: id });
  if (error) return dbError(error);
  refresh();
  return { ok: true };
}

/** New order of one list: `ids` must be exactly that list's labels. */
export async function reorderLabelsAction(kind: "collection" | "category", ids: string[]): Promise<SaveResult> {
  const owner = await requireOwner();
  if (!owner) return NOT_OWNER;
  const existing = await labelsOf(owner, kind);
  const known = new Set(existing.map((l) => l.id));
  if (!Array.isArray(ids) || ids.length !== known.size || !ids.every((id) => known.has(id))) {
    return { ok: false, error: s.errors.generic };
  }
  for (const [i, id] of ids.entries()) {
    const { error } = await owner.supabase.from("shop_catalog_labels").update({ position: i + 1 }).eq("id", id);
    if (error) return dbError(error);
  }
  refresh();
  return { ok: true };
}

export async function savePresetsAction(input: unknown): Promise<SaveResult> {
  const r = validatePresets(input);
  if (hasErrors(r.errors)) return invalid(r.errors);
  const owner = await requireOwner();
  if (!owner) return NOT_OWNER;
  const { error } = await owner.supabase.rpc("save_option_presets", { p_shop_id: owner.shopId, p_presets: r.value });
  if (error) return dbError(error);
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------- my account
/** Any member: change your own password (the current one is checked). */
export async function changePasswordAction(input: unknown): Promise<SaveResult> {
  const r = validatePasswordChange((input ?? {}) as never);
  if (hasErrors(r.errors)) return invalid(r.errors);

  const ctx = await getDashboardContext();
  if (!ctx.user.email) return { ok: false, error: s.errors.generic };

  // Check the current password with a separate client that keeps no
  // session (it doesn't touch the login cookies), then end that session.
  const { url, publishableKey } = getSupabaseEnv();
  const checker = createPlainClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: signInError } = await checker.auth.signInWithPassword({ email: ctx.user.email, password: r.value.current });
  if (signInError) {
    const tooMany = signInError.status === 429 || /rate limit/i.test(signInError.message);
    return { ok: false, error: tooMany ? s.account.errors.tooMany : undefined, fieldErrors: tooMany ? {} : { current: s.account.errors.current } };
  }
  await checker.auth.signOut({ scope: "local" });

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: r.value.next });
  if (error) {
    if (error.code === "same_password") return { ok: false, fieldErrors: { next: s.account.errors.same } };
    if (error.code === "weak_password") return { ok: false, fieldErrors: { next: s.account.errors.short } };
    console.error("[settings] password:", error.message);
    return { ok: false, error: s.errors.generic };
  }
  return { ok: true };
}
