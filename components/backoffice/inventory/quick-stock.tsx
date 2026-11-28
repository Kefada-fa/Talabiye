"use client";

import { useState, useTransition } from "react";
import { changeStockAction } from "@/app/dashboard/inventory/actions";
import { fill, t } from "@/lib/i18n";
import { variantLabel } from "@/lib/inventory/stock";
import type { InvItem } from "@/lib/inventory/types";

const q = t.backoffice.inventory.quick;

type Row = { variantId: string | null; label: string; stock: number | null };

/**
 * −/+ and a number box per option (or one row for items without options).
 * Not tracked → "Start counting" (sets 0). Every change is saved right away
 * and checked by the server (can't go below 0).
 */
export function QuickStock({
  item,
  onChanged,
}: {
  item: InvItem;
  onChanged?: (variantId: string | null, stock: number) => void;
}) {
  const initial: Row[] =
    item.variants.length > 0
      ? item.variants.map((v) => ({ variantId: v.id, label: variantLabel(item, v), stock: v.stock }))
      : [{ variantId: null, label: q.noOptions, stock: item.stock }];
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedRow, setSavedRow] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(row: Row, delta: number | null, set: number | null) {
    setError(null);
    startTransition(async () => {
      const res = await changeStockAction(item.id, row.variantId, delta, set);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((old) => old.map((r) => (r.variantId === row.variantId ? { ...r, stock: res.stock } : r)));
      setSavedRow(row.variantId ?? "single");
      onChanged?.(row.variantId, res.stock);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-bo-muted">{q.hint}</p>
      <ul className="flex flex-col divide-y divide-bo-border rounded-xl border border-bo-border">
        {rows.map((row) => (
          <StockRow
            key={row.variantId ?? "single"}
            row={row}
            pending={pending}
            saved={savedRow === (row.variantId ?? "single")}
            onDelta={(d) => run(row, d, null)}
            onSet={(n) => run(row, null, n)}
          />
        ))}
      </ul>
      {error && <p role="alert" className="text-sm font-medium text-status-refused-fg">{error}</p>}
    </div>
  );
}

function StockRow({
  row,
  pending,
  saved,
  onDelta,
  onSet,
}: {
  row: Row;
  pending: boolean;
  saved: boolean;
  onDelta: (d: number) => void;
  onSet: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const btn =
    "inline-flex h-11 w-11 items-center justify-center rounded-xl border border-bo-border bg-white text-xl font-semibold hover:bg-bo-page disabled:opacity-40";

  function commit() {
    if (draft === null) return;
    const n = Number(draft);
    if (/^\d{1,7}$/.test(draft.trim()) && n !== row.stock) onSet(n);
    setDraft(null);
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span className="min-w-0 flex-1 text-sm font-medium">
        {row.label}
        {saved && <span className="ml-2 text-xs font-semibold text-status-paid-fg">{q.saved}</span>}
      </span>
      {row.stock === null ? (
        <span className="flex items-center gap-2">
          <span className="text-sm text-bo-muted">{q.notTracked}</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSet(0)}
            className="inline-flex min-h-11 items-center rounded-xl border border-bo-border bg-white px-3 text-sm font-semibold hover:bg-bo-page disabled:opacity-60"
          >
            {q.startCounting}
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <button type="button" className={btn} disabled={pending || row.stock <= 0} aria-label={fill(q.decrease, { name: row.label })} onClick={() => onDelta(-1)}>
            −
          </button>
          <input
            aria-label={fill(q.amount, { name: row.label })}
            inputMode="numeric"
            value={draft ?? String(row.stock)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className="h-11 w-16 rounded-xl border border-bo-border text-center text-base tabular-nums outline-none focus:border-bo-accent focus:ring-2 focus:ring-bo-accent/25"
          />
          <button type="button" className={btn} disabled={pending} aria-label={fill(q.increase, { name: row.label })} onClick={() => onDelta(1)}>
            +
          </button>
        </span>
      )}
    </li>
  );
}
