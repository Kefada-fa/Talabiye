import { MAX_QTY_PER_ITEM, type StoreProduct, type StoreVariant } from "./types";

export function variantPrice(product: StoreProduct, variant: StoreVariant | null): number {
  return variant?.priceOverride ?? product.price;
}

/** Lowest and highest price a product can have (options may cost more). */
export function priceRange(product: StoreProduct): { min: number; max: number } {
  if (product.variants.length === 0) return { min: product.price, max: product.price };
  const prices = product.variants.map((v) => variantPrice(product, v));
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function inStock(stock: number | null): boolean {
  return stock === null || stock > 0;
}

/** Can at least one unit of this product be bought? */
export function isAvailable(product: StoreProduct): boolean {
  if (product.variants.length > 0) return product.variants.some((v) => inStock(v.stock));
  return inStock(product.stock);
}

/** How many of this product/option a customer may pick (1–20, or less if stock is low). */
export function maxQuantity(product: StoreProduct, variant: StoreVariant | null): number {
  const stock = product.variants.length > 0 ? (variant?.stock ?? null) : product.stock;
  return stock === null ? MAX_QTY_PER_ITEM : Math.max(0, Math.min(MAX_QTY_PER_ITEM, stock));
}
