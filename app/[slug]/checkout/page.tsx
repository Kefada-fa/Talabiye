import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { createFormToken } from "@/lib/checkout/form-token";
import Link from "next/link";
import { getDeliveryAreas, getShopBySlug } from "@/lib/storefront/data";
import { closedMessage } from "@/lib/storefront/ordering";
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

  // Closed by the owner (holiday): no form at all.
  if (!shop.acceptingOrders) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <h2 className="text-lg font-semibold">{t.shop.closedTitle}</h2>
        <p>{closedMessage(shop)}</p>
        <Link href={`/${shop.slug}`} className="rounded-full bg-brand-primary px-6 py-3 font-semibold text-brand-on-primary">
          {t.common.backToShop}
        </Link>
      </div>
    );
  }

  const areas = await getDeliveryAreas(shop);

  // Signed "page shown at" time for the 4-second spam check. Must be
  // created per visit (never cached), hence connection().
  await connection();
  const formToken = createFormToken();

  return <CheckoutForm shop={shop} areas={areas} formToken={formToken ?? ""} />;
}
