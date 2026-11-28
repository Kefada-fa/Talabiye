"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart/cart";
import { formatPrice, sumMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { checkoutBlock } from "@/lib/storefront/ordering";
import type { StoreShop } from "@/lib/storefront/types";
import { ProductImage } from "./product-image";
import { QuantityPicker } from "./quantity-picker";

/**
 * The cart page: items, quantities and subtotal. The delivery fee depends
 * on pickup/delivery and the address, so it's calculated at checkout.
 */
export function CartView({ slug, shop }: { slug: string; shop: StoreShop }) {
  const { items, hydrated, subtotal, setQuantity, remove } = useCart(slug);

  if (!hydrated) {
    return <p className="py-10 text-center text-zinc-500">{t.common.loading}</p>;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-zinc-600">{t.cart.empty}</p>
        <Link
          href={`/${slug}`}
          className="rounded-full bg-brand-primary px-6 py-3 font-semibold text-brand-on-primary"
        >
          {t.cart.continueShopping}
        </Link>
      </div>
    );
  }

  const blocked = checkoutBlock(shop, subtotal);

  return (
    <div className="flex flex-col gap-6">
      <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
        {items.map((item) => (
          <li key={`${item.productId}:${item.variantId ?? ""}`} className="flex gap-3 p-3">
            <ProductImage src={item.imageUrl} alt={item.name} className="h-20 w-20 shrink-0 rounded-xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-900">{item.name}</p>
                  {item.optionText && <p className="text-sm text-zinc-500">{item.optionText}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium tabular-nums">{formatPrice(item.unitPrice * item.quantity)}</p>
                  {item.listPrice > item.unitPrice && (
                    <p className="text-xs text-zinc-400 line-through tabular-nums">
                      {formatPrice(item.listPrice * item.quantity)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <QuantityPicker
                  size="sm"
                  value={item.quantity}
                  max={item.maxQuantity}
                  onChange={(n) => setQuantity(item.productId, item.variantId, n)}
                />
                <button
                  type="button"
                  onClick={() => remove(item.productId, item.variantId)}
                  className="text-sm text-zinc-500 underline underline-offset-4 hover:text-red-600"
                >
                  {t.cart.remove}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <OrderTotals subtotal={subtotal} deliveryFee={null} />

      {blocked ? (
        <>
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{blocked}</p>
          <span aria-disabled="true" className="flex h-12 items-center justify-center rounded-full bg-zinc-300 text-base font-semibold text-zinc-600">
            {t.cart.checkout}
          </span>
        </>
      ) : (
        <Link
          href={`/${slug}/checkout`}
          className="flex h-12 items-center justify-center rounded-full bg-brand-primary text-base font-semibold text-brand-on-primary"
        >
          {t.cart.checkout}
        </Link>
      )}
      <p className="text-center text-xs text-zinc-500">{t.cart.pricesNote}</p>
    </div>
  );
}

/**
 * Subtotal / delivery / total box.
 * deliveryFee: a number, 0 with `free` → "Free", or null → "Calculated at checkout".
 */
export function OrderTotals({
  subtotal,
  deliveryFee,
  free = false,
  hideDelivery = false,
}: {
  subtotal: number;
  deliveryFee: number | null;
  free?: boolean;
  hideDelivery?: boolean;
}) {
  return (
    <dl className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
      <div className="flex justify-between">
        <dt className="text-zinc-600">{t.cart.subtotal}</dt>
        <dd className="tabular-nums">{formatPrice(subtotal)}</dd>
      </div>
      {!hideDelivery && (
        <div className="flex justify-between">
          <dt className="text-zinc-600">{t.cart.delivery}</dt>
          <dd className="tabular-nums">
            {deliveryFee === null ? t.cart.deliveryAtCheckout : free ? t.cart.free : formatPrice(deliveryFee)}
          </dd>
        </div>
      )}
      <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-semibold">
        <dt>{t.cart.total}</dt>
        <dd className="tabular-nums">{formatPrice(sumMoney([subtotal, deliveryFee ?? 0]))}</dd>
      </div>
    </dl>
  );
}
