"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/cart/cart";
import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import { isAvailable, maxQuantity, priceRange, variantPrice } from "@/lib/storefront/pricing";
import { MAX_CART_LINES, type StoreProduct } from "@/lib/storefront/types";
import { QuantityPicker } from "./quantity-picker";

const LOW_STOCK = 5;

/** Option picker + quantity + "Add to cart" for one product. */
export function ProductPurchase({ slug, product }: { slug: string; product: StoreProduct }) {
  const { add } = useCart(slug);
  const hasOptions = product.variants.length > 0;

  // If there's exactly one option in stock, pick it for the customer.
  const inStockVariants = product.variants.filter((v) => v.stock === null || v.stock > 0);
  const [variantId, setVariantId] = useState<string | null>(
    hasOptions && product.variants.length === 1 && inStockVariants.length === 1
      ? inStockVariants[0].id
      : null,
  );
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<"added" | "full" | null>(null);

  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const max = maxQuantity(product, variant);
  const qty = Math.min(quantity, Math.max(1, max));
  const optionName = (product.optionLabel ?? t.product.option).toLowerCase();

  const range = priceRange(product);
  const priceText = variant
    ? formatPrice(variantPrice(product, variant))
    : range.min === range.max
      ? formatPrice(range.min)
      : fill(t.product.from, { price: formatPrice(range.min) });

  const soldOut = !isAvailable(product);
  const needsChoice = hasOptions && !variant;
  const canAdd = !soldOut && !needsChoice && max > 0;
  const trackedStock = hasOptions ? (variant?.stock ?? null) : product.stock;

  function handleAdd() {
    if (!canAdd) return;
    const ok = add(
      {
        productId: product.id,
        variantId: variant?.id ?? null,
        name: product.name,
        optionLabel: product.optionLabel,
        variantLabel: variant?.label ?? null,
        unitPrice: variantPrice(product, variant),
        maxQuantity: max,
        imageUrl: product.imageUrl,
      },
      qty,
    );
    setMessage(ok ? "added" : "full");
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-2xl font-semibold text-zinc-900">{priceText}</p>

      {hasOptions && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-zinc-700">
            {fill(t.product.chooseOption, { option: optionName })}
          </legend>
          <div className="flex flex-wrap gap-2">
            {product.variants.map((v) => {
              const out = v.stock !== null && v.stock <= 0;
              const selected = v.id === variantId;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={out}
                  aria-pressed={selected}
                  onClick={() => {
                    setVariantId(v.id);
                    setMessage(null);
                  }}
                  className={[
                    "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                    selected
                      ? "border-brand-primary bg-brand-primary text-brand-on-primary"
                      : "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-500",
                    out ? "cursor-not-allowed border-dashed text-zinc-400 line-through hover:border-zinc-300" : "",
                  ].join(" ")}
                >
                  {v.label}
                  {out && <span className="sr-only"> — {t.product.soldOut}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {soldOut ? (
        <p className="font-medium text-red-600">{t.product.outOfStock}</p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-zinc-700">{t.product.quantity}</span>
            <QuantityPicker
              value={qty}
              max={Math.max(1, max)}
              onChange={(n) => {
                setQuantity(n);
                setMessage(null);
              }}
            />
            {trackedStock !== null && trackedStock > 0 && trackedStock <= LOW_STOCK && (
              <span className="text-sm text-amber-700">{fill(t.product.onlyLeft, { count: trackedStock })}</span>
            )}
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="h-12 w-full rounded-full bg-brand-primary text-base font-semibold text-brand-on-primary transition-opacity disabled:opacity-40"
          >
            {needsChoice ? fill(t.product.chooseOption, { option: optionName }) : t.product.addToCart}
          </button>
        </>
      )}

      <div aria-live="polite" className="min-h-6 text-sm">
        {message === "added" && (
          <p className="flex flex-wrap items-center gap-3 text-brand-primary">
            <span className="font-medium">{t.product.added}</span>
            <Link href={`/${slug}/cart`} className="font-semibold underline underline-offset-4">
              {t.product.viewCart}
            </Link>
          </p>
        )}
        {message === "full" && (
          <p className="text-red-600">{fill(t.product.cartFull, { max: MAX_CART_LINES })}</p>
        )}
      </div>
    </div>
  );
}
