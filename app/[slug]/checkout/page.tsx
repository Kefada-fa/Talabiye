import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { createFormToken } from "@/lib/checkout/form-token";
import { getDeliveryAreas, getShopBySlug } from "@/lib/storefront/data";
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

  const areas = await getDeliveryAreas(shop);

  // Signed "page shown at" time for the 4-second spam check. Must be
  // created per visit (never cached), hence connection().
  await connection();
  const formToken = createFormToken();

  return <CheckoutForm shop={shop} areas={areas} formToken={formToken ?? ""} />;
}
