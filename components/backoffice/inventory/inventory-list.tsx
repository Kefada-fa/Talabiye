"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatPrice, sumMoney } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import { expiryState, stockStatus, stockTotals, stockValue } from "@/lib/inventory/stock";
import type { InvItem, InventoryData } from "@/lib/inventory/types";
import { inputClass, primaryButton, secondaryButton } from "@/components/backoffice/settings/kit";
import { CloseIcon } from "@/components/backoffice/icons";
import { QuickStock } from "./quick-stock";

const inv = t.backoffice.inventory;

type Sort = keyof typeof inv.sorts;
type StockFilter = "" | "inStock" | "low" | "soldOut" | "untracked";

export function InventoryList({ data }: { data: InventoryData }) {
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("");
  const [category, setCategory] = useState("");
  const [visibility, setVisibility] = useState<"" | "visible" | "hidden">("");
  const [stock, setStock] = useState<StockFilter>("");
  const [expiring, setExpiring] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [quickId, setQuickId] = useState<string | null>(null);
  // Local copy, so quick-stock changes show on the cards right away.
  const [items, setItems] = useState(data.items);
  const quickItem = items.find((it) => it.id === quickId) ?? null;

  function onStockChanged(productId: string, variantId: string | null, stockNow: number) {
    setItems((old) =>
      old.map((it) =>
        it.id !== productId
          ? it
          : variantId
            ? { ...it, variants: it.variants.map((v) => (v.id === variantId ? { ...v, stock: stockNow } : v)) }
            : { ...it, stock: stockNow },
      ),
    );
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((it) => {
      if (q && ![it.name, it.code, it.brand, it.barcode].some((x) => x?.toLowerCase().includes(q))) return false;
      if (collection && it.collection !== collection) return false;
      if (category && !it.categories.includes(category)) return false;
      if (visibility === "visible" && !it.isActive) return false;
      if (visibility === "hidden" && it.isActive) return false;
      if (stock) {
        const st = stockStatus(it, data.lowStockAt);
        const anyUntracked = stockTotals(it).anyUntracked;
        if (stock === "untracked" ? !anyUntracked : stock === "inStock" ? st !== "inStock" && st !== "low" && !anyUntracked : st !== stock) return false;
      }
      if (expiring && expiryState(it.expiryDate, data.today) === null) return false;
      return true;
    });
    const price = (it: InvItem) => it.salePrice ?? it.price;
    const sorters: Record<Sort, (a: InvItem, b: InvItem) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name),
      priceLow: (a, b) => price(a) - price(b),
      priceHigh: (a, b) => price(b) - price(a),
      stockLow: (a, b) => stockTotals(a).pieces - stockTotals(b).pieces,
    };
    return [...list].sort(sorters[sort]);
  }, [items, data.lowStockAt, data.today, query, collection, category, visibility, stock, expiring, sort]);

  const pieces = filtered.reduce((n, it) => n + stockTotals(it).pieces, 0);
  const values = filtered.map(stockValue);
  const atSell = sumMoney(values.map((v) => v.atSell));
  const withCost = values.filter((v) => v.atCost !== null);
  const atCost = sumMoney(withCost.map((v) => v.atCost as number));
  const filtersOn = !!(collection || category || visibility || stock || expiring);

  function clear() {
    setCollection("");
    setCategory("");
    setVisibility("");
    setStock("");
    setExpiring(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search + buttons */}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          aria-label={inv.search}
          placeholder={inv.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputClass} min-w-0 flex-1 basis-60`}
        />
        <button type="button" className={secondaryButton} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          {inv.filters}
          {filtersOn ? " •" : ""}
        </button>
        <label className="sr-only" htmlFor="inv-sort">{inv.sort}</label>
        <select id="inv-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-11 rounded-xl border border-bo-border bg-white px-3 text-base text-bo-ink outline-none focus:border-bo-accent focus:ring-2 focus:ring-bo-accent/25">
          {(Object.keys(inv.sorts) as Sort[]).map((k) => (
            <option key={k} value={k}>{inv.sorts[k]}</option>
          ))}
        </select>
        <Link href="/dashboard/inventory/new" className={`${primaryButton} hidden md:inline-flex`}>{inv.addShort}</Link>
      </div>

      {showFilters && (
        <div className="grid gap-3 rounded-bo-card border border-bo-border bg-bo-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect label={inv.collection} value={collection} onChange={setCollection} options={data.collections} />
          <FilterSelect label={inv.category} value={category} onChange={setCategory} options={data.categories} />
          <FilterSelect
            label={inv.visibility}
            value={visibility}
            onChange={(v) => setVisibility(v as typeof visibility)}
            options={[{ value: "visible", label: inv.visible }, { value: "hidden", label: inv.hidden }]}
          />
          <FilterSelect
            label={inv.stock}
            value={stock}
            onChange={(v) => setStock(v as StockFilter)}
            options={(Object.keys(inv.stockFilters) as (keyof typeof inv.stockFilters)[]).map((k) => ({ value: k, label: inv.stockFilters[k] }))}
          />
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input type="checkbox" checked={expiring} onChange={(e) => setExpiring(e.target.checked)} className="h-5 w-5 accent-bo-accent" />
            {inv.expiringOnly}
          </label>
          {filtersOn && (
            <button type="button" className={`${secondaryButton} w-fit`} onClick={clear}>{inv.clearFilters}</button>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="text-sm text-bo-muted">
        <p>
          {filtered.length === 1
            ? fill(inv.summaryOne, { pieces })
            : fill(inv.summary, { items: filtered.length, pieces })}
        </p>
        {data.isOwner && (
          <p>
            {withCost.length > 0
              ? fill(inv.summaryValue, { cost: formatPrice(atCost), sell: formatPrice(atSell) })
              : fill(inv.summaryValueNoCost, { sell: formatPrice(atSell) })}
          </p>
        )}
      </div>

      {/* Grid */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-bo-card border border-bo-border bg-bo-card p-10 text-center">
          <p className="text-bo-muted">{inv.empty}</p>
          <Link href="/dashboard/inventory/new" className={primaryButton}>{inv.addShort}</Link>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-bo-muted">{inv.noMatch}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 xl:grid-cols-5">
          {filtered.map((item) => (
            <ItemCard key={item.id} item={item} data={data} onQuick={() => setQuickId(item.id)} />
          ))}
        </ul>
      )}

      {quickItem && (
        <QuickStockSheet
          item={quickItem}
          onClose={() => setQuickId(null)}
          onChanged={(variantId, n) => onStockChanged(quickItem.id, variantId, n)}
        />
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
}) {
  const id = `filter-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">{inv.all}</option>
        {options.map((o) =>
          typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>,
        )}
      </select>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "muted" | "sale" | "warn" | "bad" }) {
  const cls = {
    muted: "bg-status-cancelled-bg text-status-cancelled-fg",
    sale: "bg-status-paid-bg text-status-paid-fg",
    warn: "bg-bo-attention-bg text-bo-attention-text",
    bad: "bg-status-refused-bg text-status-refused-fg",
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function ItemCard({ item, data, onQuick }: { item: InvItem; data: InventoryData; onQuick: () => void }) {
  const status = stockStatus(item, data.lowStockAt);
  const totals = stockTotals(item);
  const expiry = expiryState(item.expiryDate, data.today);
  const onSale = item.salePrice !== null;

  return (
    <li className="flex flex-col overflow-hidden rounded-bo-card border border-bo-border bg-bo-card">
      <Link href={`/dashboard/inventory/${item.id}`} className="group flex flex-1 flex-col">
        <div className="relative aspect-square bg-bo-page">
          {item.photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- storage URL
            <img src={item.photos[0].url} alt="" loading="lazy" className={`h-full w-full object-cover ${item.isActive ? "" : "opacity-60"}`} />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-bo-muted">{t.product.noPhoto}</span>
          )}
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {!item.isActive && <Tag tone="muted">{inv.tags.hidden}</Tag>}
            {onSale && <Tag tone="sale">{inv.tags.sale}</Tag>}
            {status === "soldOut" && <Tag tone="bad">{inv.tags.soldOut}</Tag>}
            {status === "low" && <Tag tone="warn">{inv.tags.low}</Tag>}
            {expiry === "soon" && <Tag tone="warn">{inv.tags.expiresSoon}</Tag>}
            {expiry === "expired" && <Tag tone="bad">{inv.tags.expired}</Tag>}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-3">
          <p className="line-clamp-2 text-sm font-semibold text-bo-ink group-hover:underline">{item.name}</p>
          <p className="text-xs text-bo-muted">{item.code ?? inv.noCode}</p>
          <p className="mt-auto flex flex-wrap items-baseline gap-x-1.5 pt-1 text-sm font-semibold">
            {formatPrice(item.salePrice ?? item.price)}
            {onSale && <span className="text-xs font-normal text-bo-muted line-through">{formatPrice(item.price)}</span>}
          </p>
          <p className="text-xs text-bo-muted">
            {totals.allUntracked ? inv.untracked : fill(inv.pieces, { count: totals.pieces })}
            {!totals.allUntracked && totals.anyUntracked ? ` + ${inv.untracked.toLowerCase()}` : ""}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={onQuick}
        className="min-h-11 border-t border-bo-border text-sm font-semibold text-bo-accent hover:bg-bo-page"
      >
        {inv.quickStock}
      </button>
    </li>
  );
}

/** Bottom sheet (phone) / dialog (computer) with the quick-stock rows. */
function QuickStockSheet({
  item,
  onClose,
  onChanged,
}: {
  item: InvItem;
  onClose: () => void;
  onChanged: (variantId: string | null, stock: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={fill(inv.quick.title, { name: item.name })}>
      <button type="button" aria-label={t.common.close} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-bo-card p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-xl md:max-w-lg md:rounded-bo-card">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-bo-heading text-lg font-semibold">{fill(inv.quick.title, { name: item.name })}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t.common.close} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-bo-page">
            <CloseIcon />
          </button>
        </div>
        <QuickStock item={item} onChanged={onChanged} />
      </div>
    </div>
  );
}
