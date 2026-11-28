"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getUnconfirmedCountAction, switchShopAction } from "@/lib/backoffice/actions";
import { logOutAction } from "@/lib/auth/actions";
import { fill, t } from "@/lib/i18n";
import {
  BoxIcon, ChartIcon, CloseIcon, DotsIcon, ExternalIcon, GearIcon, HomeIcon,
  InvoiceIcon, LogoutIcon, PlusIcon, PulseIcon, UsersIcon,
} from "./icons";

type ShopInfo = { id: string; name: string; slug: string; logoUrl: string | null };

const nav = t.backoffice.nav;

const NAV = [
  { href: "/dashboard", label: nav.home, Icon: HomeIcon, exact: true },
  { href: "/dashboard/invoices", label: nav.invoices, Icon: InvoiceIcon, badge: true },
  { href: "/dashboard/inventory", label: nav.inventory, Icon: BoxIcon },
  { href: "/dashboard/customers", label: nav.customers, Icon: UsersIcon },
  { href: "/dashboard/reports", label: nav.reports, Icon: ChartIcon },
  { href: "/dashboard/traffic", label: nav.traffic, Icon: PulseIcon },
  { href: "/dashboard/settings", label: nav.settings, Icon: GearIcon },
] as const;

const PHONE_TABS = NAV.slice(0, 4); // Home, Invoices, Inventory, Customers (+ More)
const MORE_ITEMS = NAV.slice(4); // Reports, Traffic, Settings

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/** Page title for the phone top bar. */
function titleFor(pathname: string): string {
  const match = [...NAV].reverse().find((n) => isActive(pathname, n.href, "exact" in n && n.exact));
  return match?.label ?? nav.home;
}

/**
 * Back-office frame: dark sidebar (computer) or top bar + bottom tabs
 * (phone, under 768px). Shows the unconfirmed-orders count, refreshed on
 * every page change and every 60 seconds.
 */
export function AppShell({
  shop,
  shops,
  initialUnconfirmed,
  children,
}: {
  shop: ShopInfo;
  shops: { id: string; name: string }[];
  initialUnconfirmed: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // (The layout gives AppShell a new `key` per shop, so this starts fresh
  // after a shop switch.)
  const [unconfirmed, setUnconfirmed] = useState(initialUnconfirmed);
  // The "More" sheet remembers the page it was opened on, so it closes by
  // itself when the user goes to another page.
  const [moreOpenOn, setMoreOpenOn] = useState<string | null>(null);
  const moreOpen = moreOpenOn === pathname;
  const setMoreOpen = (open: boolean) => setMoreOpenOn(open ? pathname : null);

  // Refresh the count on every page change and every 60 seconds.
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      getUnconfirmedCountAction(shop.id)
        .then((n) => alive && setUnconfirmed(n))
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pathname, shop.id]);

  return (
    <div className="flex min-h-full flex-1">
      {/* ---------- Computer: sidebar ---------- */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-bo-sidebar text-bo-sidebar-text md:flex">
        <ShopHeader shop={shop} shops={shops} pathname={pathname} />
        <nav aria-label={nav.menu} className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="flex flex-col gap-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href, "exact" in item && item.exact);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${
                      active ? "bg-bo-sidebar-active text-white" : "hover:bg-bo-sidebar-active/60 hover:text-white"
                    }`}
                  >
                    <item.Icon />
                    <span className="flex-1">{item.label}</span>
                    {"badge" in item && item.badge && <CountBadge count={unconfirmed} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-col gap-1 border-t border-white/10 px-3 py-3">
          <a
            href={`/${shop.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium hover:bg-bo-sidebar-active/60 hover:text-white"
          >
            <ExternalIcon />
            {nav.viewShop}
          </a>
          <form action={logOutAction}>
            <button
              type="submit"
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium hover:bg-bo-sidebar-active/60 hover:text-white"
            >
              <LogoutIcon />
              {nav.logOut}
            </button>
          </form>
        </div>
      </aside>

      {/* ---------- Main area ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone: top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-bo-border bg-bo-card px-4 md:hidden">
          <h1 className="truncate font-bo-heading text-lg font-semibold">{titleFor(pathname)}</h1>
          <Link
            href="/dashboard/invoices"
            aria-label={nav.newInvoice}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-bo-accent text-white hover:bg-bo-accent-hover"
          >
            <PlusIcon className="h-6 w-6" />
          </Link>
        </header>

        <main className="flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>

        {/* Phone: bottom tabs */}
        <nav
          aria-label={nav.menu}
          className="fixed inset-x-0 bottom-0 z-20 border-t border-bo-border bg-bo-card pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <ul className="grid grid-cols-5">
            {PHONE_TABS.map((item) => {
              const active = isActive(pathname, item.href, "exact" in item && item.exact);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                      active ? "text-bo-accent" : "text-bo-muted"
                    }`}
                  >
                    <span className="relative">
                      <item.Icon className="h-6 w-6" />
                      {"badge" in item && item.badge && unconfirmed > 0 && (
                        <span className="absolute -right-3 -top-1.5">
                          <CountBadge count={unconfirmed} small />
                        </span>
                      )}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  MORE_ITEMS.some((i) => isActive(pathname, i.href)) ? "text-bo-accent" : "text-bo-muted"
                }`}
              >
                <DotsIcon className="h-6 w-6" />
                {nav.more}
              </button>
            </li>
          </ul>
        </nav>
      </div>

      {moreOpen && (
        <MoreSheet shop={shop} shops={shops} pathname={pathname} onClose={() => setMoreOpen(false)} />
      )}
    </div>
  );
}

function CountBadge({ count, small = false }: { count: number; small?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={fill(nav.unconfirmedBadge, { count })}
      className={`inline-flex items-center justify-center rounded-full bg-bo-attention font-bold text-bo-ink ${
        small ? "h-4 min-w-4 px-1 text-[10px]" : "h-6 min-w-6 px-1.5 text-xs"
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Shop initial/logo, name, link — plus the shop switcher if there are several. */
function ShopHeader({
  shop,
  shops,
  pathname,
  dark = true,
}: {
  shop: ShopInfo;
  shops: { id: string; name: string }[];
  pathname: string;
  dark?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <div className={`flex flex-col gap-3 px-5 py-5 ${dark ? "" : "border-b border-bo-border"}`}>
      <div className="flex items-center gap-3">
        {shop.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- shop logos can come from any website for now
          <img src={shop.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
        ) : (
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bo-accent font-bo-heading text-lg font-bold text-white">
            {shop.name.trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className={`truncate font-bo-heading text-base font-semibold ${dark ? "text-white" : "text-bo-ink"}`}>{shop.name}</p>
          <p className={`truncate text-xs ${dark ? "text-bo-sidebar-text/80" : "text-bo-muted"}`}>/{shop.slug}</p>
        </div>
      </div>
      {shops.length > 1 && (
        <form ref={formRef} action={switchShopAction}>
          <input type="hidden" name="next" value={pathname} />
          <label htmlFor={dark ? "shop-switch" : "shop-switch-sheet"} className="sr-only">{t.backoffice.switchShop}</label>
          <select
            id={dark ? "shop-switch" : "shop-switch-sheet"}
            name="shop_id"
            defaultValue={shop.id}
            onChange={() => formRef.current?.requestSubmit()}
            className={`min-h-11 w-full rounded-xl px-3 text-sm ${
              dark ? "border border-white/15 bg-bo-sidebar-active text-white" : "border border-bo-border bg-white text-bo-ink"
            }`}
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <noscript>
            <button type="submit" className="mt-2 min-h-11 w-full rounded-xl bg-bo-accent text-white">{t.backoffice.switchShop}</button>
          </noscript>
        </form>
      )}
    </div>
  );
}

/** Phone: the "More" sheet (Reports, Traffic, Settings, View my shop, Log out). */
function MoreSheet({
  shop,
  shops,
  pathname,
  onClose,
}: {
  shop: ShopInfo;
  shops: { id: string; name: string }[];
  pathname: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const row = "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-base font-medium text-bo-ink hover:bg-bo-page";

  return (
    <div className="fixed inset-0 z-30 md:hidden" role="dialog" aria-modal="true" aria-label={nav.more}>
      <button type="button" aria-label={nav.close} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-bo-card pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-xl">
        <div className="flex items-center justify-between px-5 pt-4">
          <p className="font-bo-heading text-lg font-semibold">{nav.more}</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={nav.close} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-bo-page">
            <CloseIcon />
          </button>
        </div>
        {shops.length > 1 && <ShopHeader shop={shop} shops={shops} pathname={pathname} dark={false} />}
        <ul className="flex flex-col gap-1 px-3 py-2">
          {MORE_ITEMS.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={row} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                <item.Icon className="h-5 w-5 text-bo-muted" />
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <a href={`/${shop.slug}`} target="_blank" rel="noopener noreferrer" className={row}>
              <ExternalIcon className="h-5 w-5 text-bo-muted" />
              {nav.viewShop}
            </a>
          </li>
          <li>
            <form action={logOutAction}>
              <button type="submit" className={row}>
                <LogoutIcon className="h-5 w-5 text-bo-muted" />
                {nav.logOut}
              </button>
            </form>
          </li>
        </ul>
      </div>
    </div>
  );
}
