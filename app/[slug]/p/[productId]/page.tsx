import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
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

async function ProductDetails({ params }: { params: Props["params"] }) {
  const { slug, productId } = await params;
  const shop = await getShopBySlug(slug);
  if (!shop) notFound();
  const product = await getProduct(shop.id, productId);
  if (!product) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/${shop.slug}`} className="text-sm text-zinc-500 hover:text-zinc-900">
        ← {t.common.backToShop}
      </Link>
      <div className="grid gap-6 sm:grid-cols-2">
        <ProductImage src={product.imageUrl} alt={product.name} className="aspect-square w-full rounded-2xl" />
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold text-zinc-900">{product.name}</h1>
          <ProductPurchase slug={shop.slug} product={product} />
          {product.description && (
            <p className="whitespace-pre-line text-zinc-700">{product.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
