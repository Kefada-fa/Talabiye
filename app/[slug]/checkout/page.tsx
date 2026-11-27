import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { getShopBySlug } from "@/lib/storefront/data";
import { CheckoutForm } from "@/components/storefront/checkout-form";

export const metadata: Metadata = { title: t.checkout.title };

export default function CheckoutPage({ params }: PageProps<"/[slug]/checkout">) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t.checkout.title}</h1>
      <Suspense fallback={<p className="py-10 text-center text-zinc-500">{t.common.loading}</p>}>
        <CheckoutLoader params={params} />
      </Suspense>
    </div>
  );
}

async function CheckoutLoader({ params }: { params: PageProps<"/[slug]/checkout">["params"] }) {
  const { slug } = await params;
  const shop = await getShopBySlug(slug);
  if (!shop) notFound();
  return <CheckoutForm slug={shop.slug} deliveryFee={shop.deliveryFee} />;
}
