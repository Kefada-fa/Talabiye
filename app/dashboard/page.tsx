import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import { getDashboardContext, getDashboardSummary } from "@/lib/backoffice/context";
import { Card, PageTitle } from "@/components/backoffice/ui";

export const metadata: Metadata = { title: t.backoffice.home.title };

const h = t.backoffice.home;

/** Back-office Home: only real numbers we already have. */
export default function DashboardHome() {
  return (
    <Suspense fallback={<TilesSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const ctx = await getDashboardContext();
  if (!ctx.current) return null; // the layout shows "No shop yet"
  const s = await getDashboardSummary(ctx.current.id);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={h.title} subtitle={fill(h.greeting, { shop: ctx.current.name })} />

      {s.unconfirmedCount > 0 && (
        <Link
          href="/dashboard/invoices?status=unconfirmed"
          className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-bo-card border border-bo-attention/60 bg-bo-attention-bg px-5 py-4 text-bo-attention-text hover:border-bo-attention"
        >
          <span className="flex items-center gap-3 font-semibold">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-bo-attention" />
            {s.unconfirmedCount === 1 ? h.bannerOne : fill(h.banner, { count: s.unconfirmedCount })}
          </span>
          <span className="font-semibold underline underline-offset-4">{h.review} →</span>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label={h.unconfirmed} value={String(s.unconfirmedCount)} hint={h.unconfirmedHint} attention={s.unconfirmedCount > 0} />
        <Tile label={h.pending} value={String(s.pendingCount)} hint={fill(h.pendingHint, { amount: formatPrice(s.pendingTotal) })} />
        <Tile
          label={h.month}
          value={fill(h.monthOrders, { count: s.monthOrders })}
          hint={fill(h.monthHint, { amount: formatPrice(s.monthSales) })}
        />
      </div>

      <Card className="flex flex-col gap-1">
        <h2 className="font-bo-heading text-lg font-semibold">{h.laterTitle}</h2>
        <p className="text-bo-muted">{h.laterText}</p>
      </Card>
    </div>
  );
}

function Tile({ label, value, hint, attention = false }: { label: string; value: string; hint: string; attention?: boolean }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="flex items-center gap-2 text-sm font-medium text-bo-muted">
        {attention && <span aria-hidden className="h-2 w-2 rounded-full bg-bo-attention" />}
        {label}
      </p>
      <p className="font-bo-heading text-3xl font-semibold tabular-nums">{value}</p>
      <p className="text-sm text-bo-muted">{hint}</p>
    </Card>
  );
}

function TilesSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-bo-card border border-bo-border bg-bo-card" />
      ))}
    </div>
  );
}
