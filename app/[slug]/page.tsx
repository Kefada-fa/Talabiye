import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import { getDeliveryAreas, getProducts, getShopBySlug } from "@/lib/storefront/data";
import { isAvailable, isOnSale, priceRange } from "@/lib/storefront/pricing";
import type { StoreShop } from "@/lib/storefront/types";
import { ProductImage } from "@/components/storefront/product-image";

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getShopBySlug(slug);
  if (!shop) return { title: t.shop.notFoundTitle };
  return { title: shop.name, description: shop.description ?? undefined };
}

/** Shop home: intro + product grid (newest first). */
export default function ShopPage({ params }: PageProps<"/[slug]">) {
  return (
    <Suspense fallback={<GridSkeleton />}>
      <ShopCatalog params={params} />
    </Suspense>
  );
}

/** "Delivery from $3 · Free delivery on orders of $60 or more" */
async function deliverySummary(shop: StoreShop): Promise<string> {
  if (!shop.deliveryOn) return t.shop.pickupOnly;
  const parts: string[] = [];
  if (shop.deliveryMode === "fixed") {
    parts.push(fill(t.shop.deliveryFixed, { fee: formatPrice(shop.deliveryFixed) }));
  } else {
    const fees = (await getDeliveryAreas(shop)).map((a) => a.fee).filter((f): f is number => f !== null);
    if (fees.length > 0) parts.push(fill(t.shop.deliveryFrom, { fee: formatPrice(Math.min(...fees)) }));
  }
  if (shop.freeDeliveryOn && shop.freeDeliveryAbove !== null) {
    parts.push(fill(t.shop.freeDeliveryAbove, { amount: formatPrice(shop.freeDeliveryAbove) }));
  }
  if (shop.pickupOn) parts.push(t.shop.pickupAvailable);
  return parts.join(" · ");
}

async function ShopCatalog({ params }: { params: PageProps<"/[slug]">["params"] }) {
  const { slug } = await params;
  const shop = await getShopBySlug(slug);
  if (!shop) notFound();

  const [products, delivery] = await Promise.all([getProducts(shop.id), deliverySummary(shop)]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        {shop.heroText && <p className="text-lg font-medium text-zinc-900">{shop.heroText}</p>}
        {shop.description && <p className="text-zinc-700">{shop.description}</p>}
        {delivery && <p className="text-sm text-zinc-500">{delivery}</p>}
      </section>

      {products.length === 0 ? (
        <p className="py-16 text-center text-zinc-500">{t.shop.noProducts}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {products.map((product) => {
            const range = priceRange(product);
            const available = isAvailable(product);
            const onSale = isOnSale(product);
            return (
              <li key={product.id}>
                <Link
                  href={`/${shop.slug}/p/${product.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-md"
                >
                  <div className="relative">
                    <ProductImage src={product.photos[0] ?? null} alt={product.name} className="aspect-square w-full" />
                    {!available ? (
                      <span className="absolute left-2 top-2 rounded-full bg-zinc-900/80 px-2 py-0.5 text-xs font-medium text-white">
                        {t.product.soldOut}
                      </span>
                    ) : (
                      onSale && (
                        <span className="absolute left-2 top-2 rounded-full bg-brand-accent px-2 py-0.5 text-xs font-semibold text-white">
                          {t.product.sale}
                        </span>
                      )
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <h2 className="line-clamp-2 text-sm font-medium text-zinc-900">{product.name}</h2>
                    <p className="mt-auto flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-zinc-900">
                      <span>
                        {range.min === range.max
                          ? formatPrice(range.min)
                          : fill(t.product.from, { price: formatPrice(range.min) })}
                      </span>
                      {onSale && product.variants.length === 0 && (
                        <span className="text-xs font-normal text-zinc-400 line-through">
                          {formatPrice(product.price)}
                        </span>
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GridSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4" aria-label={t.common.loading}>
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          <div className="aspect-square w-full animate-pulse bg-zinc-100" />
          <div className="flex flex-col gap-2 p-3">
            <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-100" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-100" />
          </div>
        </li>
      ))}
    </ul>
  );
}
