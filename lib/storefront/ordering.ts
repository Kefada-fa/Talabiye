import { formatPrice, sumMoney } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import type { StoreShop } from "./types";

/** The shop's "closed" text (its own message, or the default one). */
export function closedMessage(shop: StoreShop): string {
  return shop.closedMessage?.trim() || fill(t.shop.closedDefault, { shop: shop.name });
}

/**
 * Why this cart can't be ordered right now (null = it can).
 * Display only: place_order checks the same rules with real prices.
 */
export function checkoutBlock(shop: StoreShop, subtotal: number): string | null {
  if (!shop.acceptingOrders) return closedMessage(shop);
  if (shop.minOrder !== null && subtotal < shop.minOrder) {
    return fill(t.cart.belowMinimum, {
      amount: formatPrice(shop.minOrder),
      missing: formatPrice(sumMoney([shop.minOrder, -subtotal])),
    });
  }
  return null;
}
