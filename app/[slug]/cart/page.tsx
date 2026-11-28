import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { getShopBySlug } from "@/lib/storefront/data";
import { CartView } from "@/components/storefront/cart-view";

export const metadata: Metadata = { title: t.cart.title };

/** Cart page. The cart itself lives in the browser (localStorage). */
export default function CartPage({ params }: PageProps<"/[slug]/cart">) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t.cart.title}</h1>
      <Suspense fallback={<p className="py-10 text-center text-zinc-500">{t.common.loading}</p>}>
        <CartLoader params={params} />
      </Suspense>
    </div>
  );
}

async function CartLoader({ params }: { params: PageProps<"/[slug]/cart">["params"] }) {
  const { slug } = await params;
  const shop = await getShopBySlug(slug);
  if (!shop) notFound();
  return <CartView slug={shop.slug} shop={shop} />;
}
