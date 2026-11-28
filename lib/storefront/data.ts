import "server-only";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import { photoUrl } from "./photos";
import type {
  DeliveryArea,
  StoreOptionType,
  StoreProduct,
  StoreShop,
  StoreVariant,
} from "./types";

// Same rules as the database, checked first so bad URLs never hit the DB.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * An active shop (with its PUBLIC settings) by its URL slug, or null.
 * cache() → layout and page share one database call per request.
 */
export const getShopBySlug = cache(async (slug: string): Promise<StoreShop | null> => {
  if (!isValidSlug(slug)) return null;

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("shops")
    .select(
      "id, name, slug, description, logo_url, whatsapp_number, delivery_on, delivery_mode, " +
        "delivery_fixed, free_delivery_on, free_delivery_above, delivery_note, description_on, " +
        "policy_on, policy_text, low_stock_at, hero_text",
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`Could not load shop: ${error.message}`);
  if (!data) return null;
  const s = data as unknown as Record<string, unknown>;

  return {
    id: s.id as string,
    name: s.name as string,
    slug: s.slug as string,
    description: (s.description as string | null) ?? null,
    logoUrl: (s.logo_url as string | null) ?? null,
    whatsappNumber: (s.whatsapp_number as string | null) ?? null,
    deliveryOn: Boolean(s.delivery_on),
    deliveryMode: s.delivery_mode === "governorate" ? "governorate" : "fixed",
    deliveryFixed: Number(s.delivery_fixed ?? 0),
    freeDeliveryOn: Boolean(s.free_delivery_on),
    freeDeliveryAbove: num(s.free_delivery_above as number | string | null),
    deliveryNote: (s.delivery_note as string | null) ?? null,
    descriptionOn: Boolean(s.description_on),
    policyOn: Boolean(s.policy_on),
    policyText: (s.policy_text as string | null) ?? null,
    lowStockAt: Number(s.low_stock_at ?? 3),
    heroText: (s.hero_text as string | null) ?? null,
  };
});

const PRODUCT_COLUMNS =
  "id, name, description, price, sale_price, image_url, option_label, stock, code, brand, weight, " +
  "expiry_date, created_at, " +
  "product_option_types (id, name, position, product_option_values (id, value, position, created_at)), " +
  "product_variants (id, label, stock, price_override, sort_order, created_at, value1_id, value2_id), " +
  "product_photos (storage_path, position, created_at)";

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  sale_price: number | string | null;
  image_url: string | null;
  option_label: string | null;
  stock: number | null;
  code: string | null;
  brand: string | null;
  weight: string | null;
  expiry_date: string | null;
  product_option_types: {
    id: string;
    name: string;
    position: number;
    product_option_values: { id: string; value: string; position: number; created_at: string }[];
  }[];
  product_variants: {
    id: string;
    label: string;
    stock: number | null;
    price_override: number | string | null;
    sort_order: number;
    created_at: string;
    value1_id: string | null;
    value2_id: string | null;
  }[];
  product_photos: { storage_path: string; position: number; created_at: string }[];
};

const byPositionThenDate = (
  a: { position: number; created_at: string },
  b: { position: number; created_at: string },
) => a.position - b.position || a.created_at.localeCompare(b.created_at);

function toProduct(row: ProductRow): StoreProduct {
  const rawVariants = [...(row.product_variants ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
  );

  let optionTypes: StoreOptionType[] = [...(row.product_option_types ?? [])]
    .sort((a, b) => a.position - b.position)
    .slice(0, 2)
    .map((t) => ({
      id: t.id,
      name: t.name,
      position: (t.position === 2 ? 2 : 1) as 1 | 2,
      values: [...(t.product_option_values ?? [])]
        .sort(byPositionThenDate)
        .map((v) => ({ id: v.id, value: v.value })),
    }));

  let variants: StoreVariant[] = rawVariants.map((v) => ({
    id: v.id,
    value1Id: v.value1_id,
    value2Id: v.value2_id,
    label: v.label,
    stock: v.stock,
    priceOverride: num(v.price_override),
  }));

  // Older data: variants without option values → one option type built
  // from the variant labels, so the picker still works.
  if (variants.length > 0 && variants.some((v) => !v.value1Id)) {
    const typeId = `legacy-${row.id}`;
    optionTypes = [
      {
        id: typeId,
        name: row.option_label ?? "Option",
        position: 1,
        values: variants.map((v) => ({ id: `legacy-${v.id}`, value: v.label })),
      },
    ];
    variants = variants.map((v) => ({ ...v, value1Id: `legacy-${v.id}`, value2Id: null }));
  }

  const photos = [...(row.product_photos ?? [])]
    .sort(byPositionThenDate)
    .map((p) => photoUrl(p.storage_path));
  if (photos.length === 0 && row.image_url) photos.push(row.image_url);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    salePrice: num(row.sale_price),
    photos,
    code: row.code,
    brand: row.brand,
    weight: row.weight,
    expiryDate: row.expiry_date,
    stock: row.stock,
    optionTypes,
    variants,
  };
}

/** All active products of a shop, newest first. */
export const getProducts = cache(async (shopId: string): Promise<StoreProduct[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("shop_id", shopId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load products: ${error.message}`);
  return ((data ?? []) as unknown as ProductRow[]).map(toProduct);
});

/** One active product of a shop, or null. */
export const getProduct = cache(
  async (shopId: string, productId: string): Promise<StoreProduct | null> => {
    if (!UUID_RE.test(productId)) return null;

    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("shop_id", shopId)
      .eq("id", productId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw new Error(`Could not load product: ${error.message}`);
    return data ? toProduct(data as unknown as ProductRow) : null;
  },
);

/**
 * Governorates + districts for the checkout, with this shop's delivery fee
 * for each (null = no delivery there). With a fixed fee, every governorate
 * gets the same fee. The database recalculates the fee anyway.
 */
export const getDeliveryAreas = cache(async (shop: StoreShop): Promise<DeliveryArea[]> => {
  const supabase = createPublicClient();
  const [govs, districts, fees] = await Promise.all([
    supabase.from("lebanon_governorates").select("name, sort_order").order("sort_order"),
    supabase.from("lebanon_districts").select("governorate, name, sort_order").order("sort_order"),
    supabase.from("shop_delivery_fees").select("governorate, fee").eq("shop_id", shop.id),
  ]);
  if (govs.error) throw new Error(`Could not load governorates: ${govs.error.message}`);
  if (districts.error) throw new Error(`Could not load districts: ${districts.error.message}`);
  if (fees.error) throw new Error(`Could not load delivery fees: ${fees.error.message}`);

  const feeByGov = new Map<string, number | null>(
    (fees.data ?? []).map((f) => [f.governorate as string, num(f.fee)]),
  );

  return (govs.data ?? []).map((g) => ({
    governorate: g.name as string,
    districts: (districts.data ?? [])
      .filter((d) => d.governorate === g.name)
      .map((d) => d.name as string),
    fee:
      shop.deliveryMode === "fixed"
        ? shop.deliveryFixed
        : (feeByGov.get(g.name as string) ?? null),
  }));
});
