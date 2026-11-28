"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/cart/cart";
import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import {
  findVariant,
  inStock,
  isAvailable,
  listPrice,
  maxQuantity,
  optionText,
  priceRange,
  unitPrice,
} from "@/lib/storefront/pricing";
import { MAX_CART_LINES, type StoreOptionType, type StoreProduct } from "@/lib/storefront/types";
import { QuantityPicker } from "./quantity-picker";

/**
 * Option picker (0, 1 or 2 option types named by the seller) + quantity +
 * "Add to cart" for one product.
 */
export function ProductPurchase({
  slug,
  product,
  lowStockAt,
}: {
  slug: string;
  product: StoreProduct;
  lowStockAt: number;
}) {
  const { add } = useCart(slug);
  const types = product.optionTypes;
  const hasOptions = types.length > 0;

  // Pre-select any option type that has exactly one value.
  const [chosen, setChosen] = useState<Record<string, string | undefined>>(() =>
    Object.fromEntries(types.filter((tp) => tp.values.length === 1).map((tp) => [tp.id, tp.values[0].id])),
  );
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<"added" | "full" | null>(null);

  const variant = hasOptions ? findVariant(product, chosen) : null;
  const allChosen = types.every((tp) => chosen[tp.id]);
  const max = maxQuantity(product, variant);
  const qty = Math.min(quantity, Math.max(1, max));

  const soldOut = !isAvailable(product);
  const comboSoldOut = hasOptions && allChosen && (!variant || !inStock(variant.stock));
  const missing = types.filter((tp) => !chosen[tp.id]).map((tp) => tp.name);
  const canAdd = !soldOut && allChosen && !comboSoldOut && max > 0;
  const trackedStock = hasOptions ? (variant?.stock ?? null) : product.stock;

  // Price: the chosen combination's price, or "From $X" while choosing.
  const range = priceRange(product);
  const shownUnit = !hasOptions || variant ? unitPrice(product, variant) : null;
  const shownList = !hasOptions || variant ? listPrice(product, variant) : null;

  /** Is there any in-stock combination with this value (and the other chosen value)? */
  function valueAvailable(type: StoreOptionType, valueId: string): boolean {
    const other = types.find((tp) => tp.id !== type.id);
    const otherValue = other ? chosen[other.id] : undefined;
    return product.variants.some((v) => {
      const mine = type.position === 1 ? v.value1Id : v.value2Id;
      const theirs = type.position === 1 ? v.value2Id : v.value1Id;
      return mine === valueId && (!otherValue || theirs === otherValue) && inStock(v.stock);
    });
  }
  /** Is this value sold out in EVERY combination? */
  function valueSoldOutEverywhere(type: StoreOptionType, valueId: string): boolean {
    return !product.variants.some((v) => {
      const mine = type.position === 1 ? v.value1Id : v.value2Id;
      return mine === valueId && inStock(v.stock);
    });
  }

  function handleAdd() {
    if (!canAdd) return;
    const ok = add(
      {
        productId: product.id,
        variantId: variant?.id ?? null,
        name: product.name,
        optionText: optionText(product, variant),
        unitPrice: unitPrice(product, variant),
        listPrice: listPrice(product, variant),
        maxQuantity: max,
        imageUrl: product.photos[0] ?? null,
      },
      qty,
    );
    setMessage(ok ? "added" : "full");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-3">
        {shownUnit !== null ? (
          <>
            <p className="text-2xl font-semibold text-zinc-900">{formatPrice(shownUnit)}</p>
            {shownList !== null && shownList > shownUnit && (
              <>
                <p className="text-lg text-zinc-400 line-through">{formatPrice(shownList)}</p>
                <span className="rounded-full bg-brand-accent px-2 py-0.5 text-xs font-semibold text-white">
                  {t.product.sale}
                </span>
              </>
            )}
          </>
        ) : (
          <p className="text-2xl font-semibold text-zinc-900">
            {range.min === range.max ? formatPrice(range.min) : fill(t.product.from, { price: formatPrice(range.min) })}
          </p>
        )}
      </div>

      {types.map((type) => (
        <fieldset key={type.id}>
          <legend className="mb-2 text-sm font-medium text-zinc-700">
            {fill(t.product.choose, { option: type.name })}
          </legend>
          <div className="flex flex-wrap gap-2">
            {type.values.map((v) => {
              const selected = chosen[type.id] === v.id;
              const goneEverywhere = valueSoldOutEverywhere(type, v.id);
              const dimmed = !selected && !valueAvailable(type, v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={goneEverywhere}
                  aria-pressed={selected}
                  onClick={() => {
                    setChosen((c) => ({ ...c, [type.id]: v.id }));
                    setMessage(null);
                  }}
                  className={[
                    "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                    selected
                      ? "border-brand-primary bg-brand-primary text-brand-on-primary"
                      : "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-500",
                    goneEverywhere
                      ? "cursor-not-allowed border-dashed text-zinc-400 line-through hover:border-zinc-300"
                      : dimmed
                        ? "border-dashed text-zinc-500"
                        : "",
                  ].join(" ")}
                >
                  {v.value}
                  {goneEverywhere && <span className="sr-only"> — {t.product.soldOut}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {soldOut ? (
        <p className="font-medium text-red-600">{t.product.outOfStock}</p>
      ) : (
        <>
          {comboSoldOut && <p className="text-sm font-medium text-red-600">{t.product.combinationSoldOut}</p>}

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
            {trackedStock !== null && trackedStock > 0 && trackedStock <= lowStockAt && (
              <span className="text-sm text-amber-700">{fill(t.product.onlyLeft, { count: trackedStock })}</span>
            )}
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="h-12 w-full rounded-full bg-brand-primary text-base font-semibold text-brand-on-primary transition-opacity disabled:opacity-40"
          >
            {missing.length > 0
              ? fill(t.product.choose, { option: missing.join(" & ") })
              : t.product.addToCart}
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
