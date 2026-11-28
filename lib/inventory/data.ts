import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { photoUrl } from "@/lib/storefront/photos";
import type { Buyer, InvItem, InventoryData, StockChange } from "./types";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const ITEM_COLUMNS =
  "id, name, code, description, price, sale_price, collection, categories, is_active, brand, expiry_date, " +
  "barcode, weight, stock, created_at, " +
  "product_photos (id, storage_path, position, created_at), " +
  "product_option_types (id, name, position, product_option_values (id, value, position, photo_id)), " +
  "product_variants (id, value1_id, value2_id, label, stock, price_override, sort_order)";

type Row = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  price: number | string;
  sale_price: number | string | null;
  collection: string | null;
  categories: string[] | null;
  is_active: boolean;
  brand: string | null;
  expiry_date: string | null;
  barcode: string | null;
  weight: string | null;
  stock: number | null;
  created_at: string;
  product_photos: { id: string; storage_path: string; position: number; created_at: string }[];
  product_option_types: {
    id: string;
    name: string;
    position: number;
    product_option_values: { id: string; value: string; position: number; photo_id: string | null }[];
  }[];
  product_variants: {
    id: string;
    value1_id: string | null;
    value2_id: string | null;
    label: string;
    stock: number | null;
    price_override: number | string | null;
    sort_order: number;
  }[];
};

function toItem(r: Row, costs: Map<string, number>): InvItem {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    description: r.description,
    price: Number(r.price),
    salePrice: num(r.sale_price),
    collection: r.collection,
    categories: r.categories ?? [],
    isActive: r.is_active,
    brand: r.brand,
    expiryDate: r.expiry_date,
    barcode: r.barcode,
    weight: r.weight,
    stock: r.stock,
    createdAt: r.created_at,
    photos: [...(r.product_photos ?? [])]
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
      .map((p) => ({ id: p.id, path: p.storage_path, url: photoUrl(p.storage_path) })),
    types: [...(r.product_option_types ?? [])]
      .sort((a, b) => a.position - b.position)
      .slice(0, 2)
      .map((ty) => ({
        id: ty.id,
        name: ty.name,
        position: (ty.position === 2 ? 2 : 1) as 1 | 2,
        values: [...(ty.product_option_values ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((v) => ({ id: v.id, value: v.value, photoId: v.photo_id })),
      })),
    variants: [...(r.product_variants ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({
        id: v.id,
        value1Id: v.value1_id,
        value2Id: v.value2_id,
        label: v.label,
        stock: v.stock,
        price: num(v.price_override),
      })),
    cost: costs.get(r.id) ?? null,
  };
}

/** Today's date in Lebanon (YYYY-MM-DD). */
function todayInBeirut(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut" }).format(new Date());
}

/**
 * The whole inventory of a shop, read with the user's own session (RLS):
 * members see everything; COSTS only come back for owners (the database
 * returns no cost rows to staff, and we don't even ask).
 */
export const getInventory = cache(async (shopId: string, isOwner: boolean): Promise<InventoryData> => {
  const supabase = await createClient();
  const [items, shop, labels, costs, presets] = await Promise.all([
    supabase.from("products").select(ITEM_COLUMNS).eq("shop_id", shopId).order("created_at", { ascending: false }),
    supabase.from("shops").select("low_stock_at, plan").eq("id", shopId).maybeSingle(),
    supabase.from("shop_catalog_labels").select("kind, name, position").eq("shop_id", shopId).order("position"),
    isOwner
      ? supabase.from("product_costs").select("product_id, wholesale_price").eq("shop_id", shopId)
      : Promise.resolve({ data: [] as { product_id: string; wholesale_price: number }[], error: null }),
    supabase.from("shop_option_presets").select("name, values").eq("shop_id", shopId).order("position"),
  ]);
  for (const r of [items, shop, labels, costs, presets]) if (r.error) throw new Error(`Could not load inventory: ${r.error.message}`);

  const plan = (shop.data as { plan?: string } | null)?.plan ?? "free";
  const { data: limit } = await supabase.from("plan_limits").select("max_product_photos").eq("plan", plan).maybeSingle();

  const costMap = new Map(((costs.data ?? []) as { product_id: string; wholesale_price: number | string }[]).map((c) => [c.product_id, Number(c.wholesale_price)]));
  const labelRows = (labels.data ?? []) as { kind: string; name: string }[];

  return {
    shopId,
    isOwner,
    lowStockAt: Number((shop.data as { low_stock_at?: number } | null)?.low_stock_at ?? 3),
    today: todayInBeirut(),
    maxPhotos: Number(limit?.max_product_photos ?? 10),
    collections: labelRows.filter((l) => l.kind === "collection").map((l) => l.name),
    categories: labelRows.filter((l) => l.kind === "category").map((l) => l.name),
    presets: ((presets.data ?? []) as { name: string; values: string[] }[]).map((x) => ({ name: x.name, values: x.values })),
    items: ((items.data ?? []) as unknown as Row[]).map((r) => toItem(r, costMap)),
  };
});

/** "Who bought it" (the database checks membership; no cancelled orders). */
export async function getBuyers(productId: string): Promise<Buyer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("product_buyers", { p_product_id: productId });
  if (error) {
    console.error("[inventory] buyers:", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    orderId: r.order_id as string,
    displayNumber: r.display_number as string,
    status: r.status as Buyer["status"],
    createdAt: r.created_at as string,
    customerName: (r.customer_name as string | null) ?? null,
    optionLabel: (r.option_label as string | null) ?? null,
    quantity: Number(r.quantity),
  }));
}

/** The last 20 stock changes of an item. */
export async function getStockHistory(productId: string, userId: string): Promise<StockChange[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_changes")
    .select("id, created_at, option_label, stock_from, stock_to, change, reason, user_id")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[inventory] history:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    optionLabel: (r.option_label as string | null) ?? null,
    from: r.stock_from as number | null,
    to: r.stock_to as number | null,
    change: r.change as number | null,
    reason: r.reason as StockChange["reason"],
    byMe: r.user_id === userId,
    byCustomer: r.user_id === null && r.reason === "order_placed",
  }));
}

/** Option values that appear in past orders (removing them asks first). */
export async function getOrderedValueIds(productId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("order_items").select("variant_id").eq("product_id", productId).not("variant_id", "is", null);
  const variantIds = [...new Set((data ?? []).map((r) => r.variant_id as string))];
  if (variantIds.length === 0) return [];
  const { data: vars } = await supabase.from("product_variants").select("value1_id, value2_id").in("id", variantIds);
  return [...new Set((vars ?? []).flatMap((v) => [v.value1_id as string | null, v.value2_id as string | null]).filter((x): x is string => !!x))];
}
