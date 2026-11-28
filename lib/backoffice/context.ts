import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Cookie that remembers the last shop chosen in the switcher. */
export const CURRENT_SHOP_COOKIE = "bo_shop";

export type MyShop = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isActive: boolean;
  role: "owner" | "staff";
};

export type DashboardContext = {
  user: { id: string; email: string | null };
  shops: MyShop[];
  current: MyShop | null; // null → logged in but no shop yet
};

/**
 * Who is logged in, which shops they belong to, and which shop is selected.
 * - Not logged in → redirect to /login.
 * - cache(): computed once per request, shared by the layout and the page.
 * All reads use the user's own session, so Row Level Security applies.
 */
export const getDashboardContext = cache(async (): Promise<DashboardContext> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  const userId = claims.sub;
  const email = typeof claims.email === "string" ? claims.email : null;

  const { data: rows, error } = await supabase
    .from("shop_members")
    .select("role, shops (id, name, slug, logo_url, is_active)")
    .eq("user_id", userId);
  if (error) throw new Error(`Could not load your shops: ${error.message}`);

  const shops: MyShop[] = (rows ?? [])
    .map((r) => {
      const s = (Array.isArray(r.shops) ? r.shops[0] : r.shops) as
        | { id: string; name: string; slug: string; logo_url: string | null; is_active: boolean }
        | null;
      return s
        ? {
            id: s.id,
            name: s.name,
            slug: s.slug,
            logoUrl: s.logo_url,
            isActive: s.is_active,
            role: r.role === "owner" ? ("owner" as const) : ("staff" as const),
          }
        : null;
    })
    .filter((s): s is MyShop => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  // The cookie is only a PREFERENCE, never trusted on its own: `shops` was
  // just loaded from the database for THIS user (their memberships), and
  // the cookie can only pick one of those. A shop they're not (or no
  // longer) a member of is ignored → fall back to their first shop.
  const chosen = (await cookies()).get(CURRENT_SHOP_COOKIE)?.value;
  const current = shops.find((s) => s.id === chosen) ?? shops[0] ?? null;

  return { user: { id: userId, email }, shops, current };
});

export type DashboardSummary = {
  unconfirmedCount: number;
  pendingCount: number;
  pendingTotal: number;
  monthOrders: number;
  monthSales: number;
};

const EMPTY_SUMMARY: DashboardSummary = {
  unconfirmedCount: 0,
  pendingCount: 0,
  pendingTotal: 0,
  monthOrders: 0,
  monthSales: 0,
};

/** Home numbers for one shop (the database refuses non-members). */
export const getDashboardSummary = cache(async (shopId: string): Promise<DashboardSummary> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shop_dashboard_summary", { p_shop_id: shopId });
  if (error) {
    console.error("[dashboard] summary:", error.message);
    return EMPTY_SUMMARY;
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, number | string> | undefined;
  if (!row) return EMPTY_SUMMARY;
  return {
    unconfirmedCount: Number(row.unconfirmed_count ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    pendingTotal: Number(row.pending_total ?? 0),
    monthOrders: Number(row.month_orders ?? 0),
    monthSales: Number(row.month_sales ?? 0),
  };
});
