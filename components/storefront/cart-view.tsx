"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart/cart";
import { formatPrice, sumMoney } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ProductImage } from "./product-image";
import { QuantityPicker } from "./quantity-picker";

/** The cart page: items, quantities, subtotal, delivery fee, total. */
export function CartView({ slug, deliveryFee }: { slug: string; deliveryFee: number }) {
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
                  {item.variantLabel && (
                    <p className="text-sm text-zinc-500">
                      {item.optionLabel ? `${item.optionLabel}: ` : ""}
                      {item.variantLabel}
                    </p>
                  )}
                </div>
                <p className="shrink-0 font-medium tabular-nums">
                  {formatPrice(item.unitPrice * item.quantity)}
                </p>
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

      <OrderTotals subtotal={subtotal} deliveryFee={deliveryFee} />

      <Link
        href={`/${slug}/checkout`}
        className="flex h-12 items-center justify-center rounded-full bg-brand-primary text-base font-semibold text-brand-on-primary"
      >
        {t.cart.checkout}
      </Link>
      <p className="text-center text-xs text-zinc-500">{t.cart.pricesNote}</p>
    </div>
  );
}

export function OrderTotals({ subtotal, deliveryFee }: { subtotal: number; deliveryFee: number }) {
  return (
    <dl className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
      <div className="flex justify-between">
        <dt className="text-zinc-600">{t.cart.subtotal}</dt>
        <dd className="tabular-nums">{formatPrice(subtotal)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-zinc-600">{t.cart.delivery}</dt>
        <dd className="tabular-nums">{formatPrice(deliveryFee)}</dd>
      </div>
      <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-semibold">
        <dt>{t.cart.total}</dt>
        <dd className="tabular-nums">{formatPrice(sumMoney([subtotal, deliveryFee]))}</dd>
      </div>
    </dl>
  );
}
