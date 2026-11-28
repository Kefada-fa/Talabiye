/**
 * Stock helpers shared by the list, the quick-stock panel and the editor.
 * Prices: an option's own price wins; otherwise the sale price; otherwise
 * the price (same rule as the database).
 */
import type { InvItem } from "./types";

export type StockStatus = "untracked" | "soldOut" | "low" | "inStock";

/** Total pieces (tracked only) and whether any option is not tracked. */
export function stockTotals(item: InvItem): { pieces: number; anyUntracked: boolean; allUntracked: boolean } {
  const stocks = item.variants.length > 0 ? item.variants.map((v) => v.stock) : [item.stock];
  const tracked = stocks.filter((s): s is number => s !== null);
  return {
    pieces: tracked.reduce((a, b) => a + b, 0),
    anyUntracked: tracked.length < stocks.length,
    allUntracked: tracked.length === 0,
  };
}

export function stockStatus(item: InvItem, lowStockAt: number): StockStatus {
  const { pieces, anyUntracked, allUntracked } = stockTotals(item);
  if (allUntracked) return "untracked";
  if (pieces === 0 && !anyUntracked) return "soldOut";
  if (!anyUntracked && lowStockAt > 0 && pieces <= lowStockAt) return "low";
  return anyUntracked ? "untracked" : "inStock";
}

/** Price customers pay for one piece of an option (or the item). */
export function unitPrice(item: InvItem, ownPrice: number | null = null): number {
  return ownPrice ?? item.salePrice ?? item.price;
}

/** Stock value: tracked pieces × cost, and × selling price. */
export function stockValue(item: InvItem): { atCost: number | null; atSell: number } {
  const rows = item.variants.length > 0 ? item.variants.map((v) => ({ stock: v.stock, price: v.price })) : [{ stock: item.stock, price: null }];
  let atSell = 0;
  let pieces = 0;
  for (const r of rows) {
    if (r.stock === null) continue;
    pieces += r.stock;
    atSell += r.stock * unitPrice(item, r.price);
  }
  return { atCost: item.cost === null ? null : pieces * item.cost, atSell };
}

/** "soon" = within 30 days, "expired" = before today (dates as YYYY-MM-DD). */
export function expiryState(expiry: string | null, today: string): "expired" | "soon" | null {
  if (!expiry) return null;
  if (expiry < today) return "expired";
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 30);
  return expiry <= limit.toISOString().slice(0, 10) ? "soon" : null;
}

/** Option label of a variant, e.g. "Color: Red / Size: M". */
export function variantLabel(item: InvItem, v: { value1Id: string | null; value2Id: string | null; label: string }): string {
  const parts: string[] = [];
  for (const t of item.types) {
    const id = t.position === 1 ? v.value1Id : v.value2Id;
    const val = t.values.find((x) => x.id === id);
    if (val) parts.push(`${t.name}: ${val.value}`);
  }
  return parts.join(" / ") || v.label;
}
