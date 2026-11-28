import Link from "next/link";
import { fill, t } from "@/lib/i18n";
import type { Buyer, StockChange } from "@/lib/inventory/types";
import { StatusChip } from "@/components/backoffice/status-chip";

const b = t.backoffice.inventory.buyers;
const h = t.backoffice.inventory.history;

const dateFmt = new Intl.DateTimeFormat(t.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Beirut" });
const timeFmt = new Intl.DateTimeFormat(t.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Beirut" });

function Card({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-bo-card border border-bo-border bg-bo-card p-5 md:p-6">
      <div>
        <h2 className="font-bo-heading text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-bo-muted">{intro}</p>
      </div>
      {children}
    </section>
  );
}

/** Orders that contain this item, grouped by option (no cancelled orders). */
export function WhoBought({ buyers }: { buyers: Buyer[] }) {
  const groups = new Map<string, Buyer[]>();
  for (const x of buyers) {
    const key = x.optionLabel ?? b.noOption;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  return (
    <Card title={b.title} intro={b.intro}>
      {buyers.length === 0 ? (
        <p className="text-sm text-bo-muted">{b.none}</p>
      ) : (
        [...groups.entries()].map(([label, rows]) => (
          <div key={label} className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">
              {label} · {fill(b.pieces, { count: rows.reduce((n, r) => n + r.quantity, 0) })}
            </h3>
            <ul className="flex flex-col divide-y divide-bo-border rounded-xl border border-bo-border">
              {rows.map((r, i) => (
                <li key={`${r.orderId}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <Link href={`/dashboard/invoices/${r.orderId}`} className="inline-flex min-h-11 items-center font-semibold text-bo-accent hover:underline">
                    {r.displayNumber}
                  </Link>
                  <span className="min-w-0 flex-1 truncate">{r.customerName ?? "—"}</span>
                  <span className="text-bo-muted">{dateFmt.format(new Date(r.createdAt))}</span>
                  <span className="tabular-nums">× {r.quantity}</span>
                  <StatusChip status={r.status} />
                  {r.status === "unconfirmed" && <span className="w-full text-xs text-bo-attention-text">{b.unconfirmed}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
}

/** The last 20 stock changes. */
export function StockHistory({ changes }: { changes: StockChange[] }) {
  const n = (x: number | null) => (x === null ? h.untracked : String(x));
  return (
    <Card title={h.title} intro={h.intro}>
      {changes.length === 0 ? (
        <p className="text-sm text-bo-muted">{h.none}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-bo-border rounded-xl border border-bo-border">
          {changes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span className="w-28 shrink-0 text-bo-muted">{timeFmt.format(new Date(c.createdAt))}</span>
              <span className="font-semibold">{h.reasons[c.reason]}</span>
              {c.optionLabel && <span className="text-bo-muted">{c.optionLabel}</span>}
              <span className="ml-auto tabular-nums">
                {n(c.from)} → {n(c.to)}
                {c.change !== null && c.change !== 0 && (
                  <span className={`ml-1.5 font-semibold ${c.change > 0 ? "text-status-paid-fg" : "text-status-refused-fg"}`}>
                    ({c.change > 0 ? "+" : ""}
                    {c.change})
                  </span>
                )}
              </span>
              <span className="w-full text-xs text-bo-muted">{c.byMe ? h.byYou : c.byCustomer ? h.byCustomer : h.byTeam}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
