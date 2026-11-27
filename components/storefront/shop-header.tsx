import Link from "next/link";
import type { StoreShop } from "@/lib/storefront/types";
import { CartLink } from "./cart-link";

/** The shop's own name + logo (not the platform's), with the cart button. */
export function ShopHeader({ shop }: { shop: StoreShop }) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-3 px-4">
        <Link href={`/${shop.slug}`} className="flex min-w-0 items-center gap-3">
          {shop.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logos can come from any website for now
            <img src={shop.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-zinc-200 object-cover" />
          ) : (
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary text-lg font-bold text-brand-on-primary"
            >
              {shop.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span className="truncate text-lg font-semibold text-zinc-900">{shop.name}</span>
        </Link>
        <CartLink slug={shop.slug} />
      </div>
    </header>
  );
}

export function ShopHeaderSkeleton() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center gap-3 px-4">
        <span className="h-10 w-10 animate-pulse rounded-full bg-zinc-200" />
        <span className="h-5 w-40 animate-pulse rounded bg-zinc-200" />
      </div>
    </header>
  );
}
