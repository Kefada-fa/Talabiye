"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart/cart";
import { fill, t } from "@/lib/i18n";

/** Cart button with item count, shown in the shop header. */
export function CartLink({ slug }: { slug: string }) {
  const { count, hydrated } = useCart(slug);
  const shown = hydrated ? count : 0;

  return (
    <Link
      href={`/${slug}/cart`}
      className="relative flex h-10 items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
      aria-label={`${t.cart.open} (${fill(t.cart.itemsCount, { count: shown })})`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
        <path d="M6 8h12l-1 12H7L6 8Z" strokeLinejoin="round" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" strokeLinecap="round" />
      </svg>
      <span>{t.cart.open}</span>
      {shown > 0 && (
        <span className="min-w-5 rounded-full bg-brand-primary px-1.5 text-center text-xs font-semibold leading-5 text-brand-on-primary">
          {shown}
        </span>
      )}
    </Link>
  );
}
