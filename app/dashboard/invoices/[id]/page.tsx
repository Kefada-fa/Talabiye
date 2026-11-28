import type { Metadata } from "next";
import { Suspense } from "react";
import { fill, t } from "@/lib/i18n";
import { switchShopAction } from "@/lib/backoffice/actions";
import { getDashboardContext } from "@/lib/backoffice/context";
import { createClient } from "@/lib/supabase/server";
import { StatusChip, type OrderStatus } from "@/components/backoffice/status-chip";
import { Card, ComingSoonCard, TextLink } from "@/components/backoffice/ui";

export const metadata: Metadata = { title: t.backoffice.pages.invoices.title };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const p = t.backoffice.pages.invoice;

/** One invoice — number + status for now (full page in a later step). */
export default function InvoicePage({ params }: PageProps<"/dashboard/invoices/[id]">) {
  return (
    <Suspense fallback={<div className="h-24 animate-pulse rounded-bo-card bg-bo-card" />}>
      <InvoiceContent params={params} />
    </Suspense>
  );
}

async function InvoiceContent({ params }: { params: PageProps<"/dashboard/invoices/[id]">["params"] }) {
  const { id } = await params;
  const ctx = await getDashboardContext();
  if (!ctx.current) return null;

  // The user's own session: Row Level Security only returns orders of
  // shops they belong to.
  const order = UUID_RE.test(id)
    ? (
        await (await createClient())
          .from("orders")
          .select("id, shop_id, display_number, status")
          .eq("id", id)
          .maybeSingle()
      ).data
    : null;

  if (!order) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <h1 className="font-bo-heading text-2xl font-semibold">{p.notFoundTitle}</h1>
          <p className="mt-1 text-bo-muted">{p.notFoundText}</p>
        </Card>
        <TextLink href="/dashboard/invoices">← {p.back}</TextLink>
      </div>
    );
  }

  // Opened from an email of another shop this user belongs to.
  const otherShop = order.shop_id !== ctx.current.id ? ctx.shops.find((s) => s.id === order.shop_id) : null;

  return (
    <div className="flex flex-col gap-4">
      <TextLink href="/dashboard/invoices">← {p.back}</TextLink>
      {otherShop && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-bo-attention/60 bg-bo-attention-bg text-bo-attention-text">
          <p className="font-medium">{fill(p.otherShop, { shop: otherShop.name })}</p>
          <form action={switchShopAction}>
            <input type="hidden" name="shop_id" value={otherShop.id} />
            <input type="hidden" name="next" value={`/dashboard/invoices/${order.id}`} />
            <button type="submit" className="min-h-11 rounded-xl bg-bo-accent px-4 font-semibold text-white hover:bg-bo-accent-hover">
              {fill(p.switchToShop, { shop: otherShop.name })}
            </button>
          </form>
        </Card>
      )}
      <Card className="flex flex-wrap items-center gap-3">
        <h1 className="font-bo-heading text-2xl font-semibold">{fill(p.title, { number: order.display_number })}</h1>
        <StatusChip status={order.status as OrderStatus} />
      </Card>
      <ComingSoonCard label={t.backoffice.pages.comingSoon} text={p.text} />
    </div>
  );
}
