import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { fill, t } from "@/lib/i18n";
import { getProduct, getShopBySlug } from "@/lib/storefront/data";
import { ProductImage } from "@/components/storefront/product-image";
import { ProductPurchase } from "@/components/storefront/product-purchase";

type Props = PageProps<"/[slug]/p/[productId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, productId } = await params;
  const shop = await getShopBySlug(slug);
  const product = shop ? await getProduct(shop.id, productId) : null;
  if (!shop || !product) return { title: t.product.notFoundTitle };
  return { title: `${product.name} · ${shop.name}`, description: product.description ?? undefined };
}

/** Product details page. */
export default function ProductPage({ params }: Props) {
  return (
    <Suspense fallback={<p className="py-10 text-center text-zinc-500">{t.common.loading}</p>}>
      <ProductDetails params={params} />
    </Suspense>
  );
}

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? isoDate
    : d.toLocaleDateString(t.locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

async function ProductDetails({ params }: { params: Props["params"] }) {
  const { slug, productId } = await params;
  const shop = await getShopBySlug(slug);
  if (!shop) notFound();
  const product = await getProduct(shop.id, productId);
  if (!product) notFound();

  // Optional details — shown only when the seller filled them in.
  const facts = [
    product.brand && fill(t.product.brand, { brand: product.brand }),
    product.weight && fill(t.product.weight, { weight: product.weight }),
    product.expiryDate && fill(t.product.expiry, { date: formatDate(product.expiryDate) }),
    product.code && fill(t.product.code, { code: product.code }),
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/${shop.slug}`} className="text-sm text-zinc-500 hover:text-zinc-900">
        ← {t.common.backToShop}
      </Link>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <ProductImage src={product.photos[0] ?? null} alt={product.name} className="aspect-square w-full rounded-2xl" />
          {product.photos.length > 1 && (
            <div className="grid grid-cols-4 gap-2">
              {product.photos.slice(1, 5).map((src, i) => (
                <ProductImage key={src} src={src} alt={`${product.name} ${i + 2}`} className="aspect-square w-full rounded-xl" />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold text-zinc-900">{product.name}</h1>
          <ProductPurchase slug={shop.slug} product={product} lowStockAt={shop.lowStockAt} />
          {shop.descriptionOn && product.description && (
            <p className="whitespace-pre-line text-zinc-700">{product.description}</p>
          )}
          {facts.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-zinc-500">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
