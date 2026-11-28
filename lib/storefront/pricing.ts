import { MAX_QTY_PER_ITEM, type StoreProduct, type StoreVariant } from "./types";

/**
 * What the customer pays for one unit.
 * Same rule as place_order: the option's own price wins; otherwise the
 * sale price (if any); otherwise the normal price.
 */
export function unitPrice(product: StoreProduct, variant: StoreVariant | null): number {
  return variant?.priceOverride ?? product.salePrice ?? product.price;
}

/** The price before any sale (shown crossed out when it's higher). */
export function listPrice(product: StoreProduct, variant: StoreVariant | null): number {
  return variant?.priceOverride ?? product.price;
}

/** Lowest and highest unit price a product can have. */
export function priceRange(product: StoreProduct): { min: number; max: number } {
  if (product.variants.length === 0) {
    const p = unitPrice(product, null);
    return { min: p, max: p };
  }
  const prices = product.variants.map((v) => unitPrice(product, v));
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** Is the product on sale (for the base price)? */
export function isOnSale(product: StoreProduct): boolean {
  return product.salePrice !== null && product.salePrice < product.price;
}

export function inStock(stock: number | null): boolean {
  return stock === null || stock > 0;
}

/** Can at least one unit of this product be bought? */
export function isAvailable(product: StoreProduct): boolean {
  if (product.variants.length > 0) return product.variants.some((v) => inStock(v.stock));
  return inStock(product.stock);
}

/** How many of this product/combination a customer may pick (1–20, or less if stock is low). */
export function maxQuantity(product: StoreProduct, variant: StoreVariant | null): number {
  const stock = product.variants.length > 0 ? (variant?.stock ?? null) : product.stock;
  return stock === null ? MAX_QTY_PER_ITEM : Math.max(0, Math.min(MAX_QTY_PER_ITEM, stock));
}

/** The combination matching the chosen values (one per option type), or null. */
export function findVariant(
  product: StoreProduct,
  chosen: Record<string, string | undefined>,
): StoreVariant | null {
  const [t1, t2] = product.optionTypes;
  if (!t1) return null;
  const v1 = chosen[t1.id];
  const v2 = t2 ? chosen[t2.id] : undefined;
  if (!v1 || (t2 && !v2)) return null;
  return (
    product.variants.find((v) => v.value1Id === v1 && (t2 ? v.value2Id === v2 : true)) ?? null
  );
}

/** "Flavor: Chocolate" or "Color: Red / Size: M", using the seller's own names. */
export function optionText(product: StoreProduct, variant: StoreVariant | null): string | null {
  if (!variant) return null;
  const parts: string[] = [];
  for (const type of product.optionTypes) {
    const valueId = type.position === 1 ? variant.value1Id : variant.value2Id;
    const value = type.values.find((v) => v.id === valueId);
    if (value) parts.push(`${type.name}: ${value.value}`);
  }
  return parts.length > 0 ? parts.join(" / ") : variant.label;
}
