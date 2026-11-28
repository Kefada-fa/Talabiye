import type { Metadata } from "next";
import { Suspense } from "react";
import { fill, t } from "@/lib/i18n";
import { PlaceholderPage } from "@/components/backoffice/placeholder-page";
import { StatusChip, type OrderStatus } from "@/components/backoffice/status-chip";

export const metadata: Metadata = { title: t.backoffice.pages.invoices.title };

const STATUSES: OrderStatus[] = ["unconfirmed", "pending", "paid", "cancelled", "refused"];

export default function InvoicesPage({ searchParams }: PageProps<"/dashboard/invoices">) {
  const p = t.backoffice.pages.invoices;
  return (
    <PlaceholderPage title={p.title} text={p.text}>
      <Suspense fallback={null}>
        <StatusFilter searchParams={searchParams} />
      </Suspense>
    </PlaceholderPage>
  );
}

/** Shows the status chips (and which one was asked for, e.g. from the Home banner). */
async function StatusFilter({ searchParams }: { searchParams: PageProps<"/dashboard/invoices">["searchParams"] }) {
  const params = await searchParams;
  const wanted = STATUSES.find((s) => s === params.status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {wanted ? (
        <>
          <span className="text-sm text-bo-muted">
            {fill(t.backoffice.pages.invoices.filtered, { status: t.backoffice.status[wanted] })}
          </span>
          <StatusChip status={wanted} />
        </>
      ) : (
        STATUSES.map((s) => <StatusChip key={s} status={s} />)
      )}
    </div>
  );
}
