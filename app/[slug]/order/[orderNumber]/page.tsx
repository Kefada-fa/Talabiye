import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { RECEIPT_COOKIE, decodeReceipt } from "@/lib/checkout/receipt";
import { buildWhatsappLink } from "@/lib/checkout/whatsapp";
import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import { ClearCart } from "@/components/storefront/clear-cart";
import { OrderTotals } from "@/components/storefront/cart-view";

type Props = PageProps<"/[slug]/order/[orderNumber]">;

export const metadata: Metadata = {
  title: t.order.summary,
  robots: { index: false, follow: false },
};

/**
 * "Order KF-0012 received" page.
 * Shows ONLY the receipt stored in this visitor's own short-lived cookie
 * (set by the checkout). It never looks up orders in the database, so
 * changing the number in the URL reveals nothing.
 */
export default function OrderPage({ params }: Props) {
  return (
    <Suspense fallback={<p className="py-10 text-center text-zinc-500">{t.common.loading}</p>}>
      <OrderReceipt params={params} />
    </Suspense>
  );
}

async function OrderReceipt({ params }: { params: Props["params"] }) {
  const { slug, orderNumber } = await params;
  const receipt = decodeReceipt((await cookies()).get(RECEIPT_COOKIE)?.value);

  const matches =
    receipt !== null && receipt.slug === slug && String(receipt.orderNumber) === orderNumber;

  if (!matches) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-xl font-semibold">{t.order.expiredTitle}</h1>
        <p className="max-w-sm text-zinc-600">{t.order.expiredText}</p>
        <Link href={`/${slug}`} className="mt-2 text-sm font-medium text-brand-primary underline underline-offset-4">
          {t.common.backToShop}
        </Link>
      </div>
    );
  }

  const whatsappLink = buildWhatsappLink(receipt);

  return (
    <div className="flex flex-col gap-6">
      <ClearCart slug={receipt.slug} />

      <div className="flex flex-col items-center gap-2 pt-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-primary text-2xl text-brand-on-primary" aria-hidden>
          ✓
        </span>
        <h1 className="text-2xl font-semibold">{fill(t.order.title, { number: receipt.displayNumber })}</h1>
        <p className="text-zinc-600">{fill(t.order.thanks, { name: receipt.customerName })}</p>
      </div>

      {whatsappLink ? (
        <section className="flex flex-col gap-3 rounded-2xl border-2 border-brand-primary bg-white p-4">
          <h2 className="font-semibold">{t.order.stepTitle}</h2>
          <p className="text-sm text-zinc-600">{fill(t.order.stepText, { shop: receipt.shopName })}</p>
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-14 items-center justify-center gap-2 rounded-full bg-[#25D366] text-base font-semibold text-white"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
              <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.6-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
            </svg>
            {t.order.sendWhatsapp}
          </a>
        </section>
      ) : (
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          {fill(t.order.noWhatsapp, { shop: receipt.shopName })}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.order.summary}</h2>
        <ul className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          {receipt.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="min-w-0">
                {item.quantity} × {item.name}
                {item.option && <span className="text-zinc-500"> — {item.option}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{formatPrice(item.lineTotal)}</span>
            </li>
          ))}
          {receipt.moreItems > 0 && <li className="text-zinc-500">+{receipt.moreItems}</li>}
        </ul>
        <OrderTotals
          subtotal={receipt.subtotal}
          deliveryFee={receipt.deliveryFee}
          free={receipt.freeDelivery}
          hideDelivery={receipt.method === "pickup"}
        />
        <p className="text-sm text-zinc-600">
          {receipt.method === "delivery"
            ? fill(t.order.deliveryTo, { place: receipt.place ?? "" })
            : t.order.pickup}
        </p>
        <p className="text-sm text-zinc-600">
          {fill(t.order.payment, { method: t.paymentMethods[receipt.paymentMethod] })}
        </p>
      </section>

      <Link href={`/${receipt.slug}`} className="text-center text-sm font-medium text-brand-primary underline underline-offset-4">
        {t.common.backToShop}
      </Link>
    </div>
  );
}
