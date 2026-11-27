import "server-only";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import type { StoreProduct, StoreShop, StoreVariant } from "./types";

// Same rules as the database, checked first so bad URLs never hit the DB.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * An active shop by its URL slug, or null.
 * Wrapped in React cache() so the layout and page share one database call
 * per request.
 */
export const getShopBySlug = cache(async (slug: string): Promise<StoreShop | null> => {
  if (!isValidSlug(slug)) return null;

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("shops")
    .select("id, name, slug, description, logo_url, whatsapp_number, delivery_fee")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`Could not load shop: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    description: data.description,
    logoUrl: data.logo_url,
    whatsappNumber: data.whatsapp_number,
    deliveryFee: Number(data.delivery_fee),
  };
});

const PRODUCT_COLUMNS =
  "id, name, description, price, image_url, option_label, stock, sort_order, created_at, " +
  "product_variants (id, label, stock, price_override, sort_order, created_at)";

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  image_url: string | null;
  option_label: string | null;
  stock: number | null;
  product_variants: {
    id: string;
    label: string;
    stock: number | null;
    price_override: number | string | null;
    sort_order: number;
    created_at: string;
  }[];
};

function toProduct(row: ProductRow): StoreProduct {
  const variants: StoreVariant[] = [...(row.product_variants ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .map((v) => ({
      id: v.id,
      label: v.label,
      stock: v.stock,
      priceOverride: v.price_override === null ? null : Number(v.price_override),
    }));

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    imageUrl: row.image_url,
    optionLabel: row.option_label,
    stock: row.stock,
    variants,
  };
}

/** All active products of a shop, in the shop's chosen order. */
export const getProducts = cache(async (shopId: string): Promise<StoreProduct[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("shop_id", shopId)
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");

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
