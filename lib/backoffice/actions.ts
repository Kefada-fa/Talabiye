"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CURRENT_SHOP_COOKIE, getDashboardSummary } from "./context";

/** Badge number: unconfirmed orders of a shop (0 if not allowed). */
export async function getUnconfirmedCountAction(shopId: string): Promise<number> {
  if (typeof shopId !== "string" || shopId.length > 64) return 0;
  const summary = await getDashboardSummary(shopId); // the database checks membership
  return summary.unconfirmedCount;
}

/** Shop switcher: remember the chosen shop (only if the user is a member). */
export async function switchShopAction(formData: FormData): Promise<void> {
  const shopId = formData.get("shop_id");
  const next = formData.get("next");
  if (typeof shopId !== "string") redirect("/dashboard");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { data: member } = await supabase
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", claims.claims.sub)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (member) {
    (await cookies()).set(CURRENT_SHOP_COOKIE, shopId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // remember for a year
    });
  }

  const target = typeof next === "string" && next.startsWith("/dashboard") && !next.startsWith("//") ? next : "/dashboard";
  redirect(target);
}
