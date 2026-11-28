import "server-only";
import { createClient } from "@/lib/supabase/server";
import { shopAssetUrl } from "@/lib/storefront/photos";
import type { CatalogLabel, ShopSettings } from "@/lib/settings/types";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * All settings of one shop, read with the logged-in user's session (RLS):
 * members (owners AND staff) can read them; other shops get nothing.
 */
export async function getShopSettings(shopId: string): Promise<ShopSettings | null> {
  const supabase = await createClient();
  const [shop, govs, fees, priv, notif, labels, usage, presets] = await Promise.all([
    supabase
      .from("shops")
      .select(
        "id, slug, name, tagline, hero_text, whatsapp_number, instagram, facebook, primary_color, accent_color, " +
          "logo_path, logo_url, description, share_image_path, accepting_orders, closed_message, min_order_amount, " +
          "max_pieces, delivery_on, delivery_mode, delivery_fixed, free_delivery_on, free_delivery_above, " +
          "delivery_note, pickup_on, pickup_note, description_on, low_stock_at, policy_on, policy_text, " +
          "reviews_on, reviews_need_approval",
      )
      .eq("id", shopId)
      .maybeSingle(),
    supabase.from("lebanon_governorates").select("name, sort_order").order("sort_order"),
    supabase.from("shop_delivery_fees").select("governorate, fee").eq("shop_id", shopId),
    supabase
      .from("shop_private_settings")
      .select(
        "invoice_prefix, deposit_on, deposit_type, deposit_amount, deposit_instructions, " +
          "wa_confirm_template, wa_deposit_template, wa_review_template",
      )
      .eq("shop_id", shopId)
      .maybeSingle(),
    supabase.from("shop_notification_settings").select("order_emails, email_enabled").eq("shop_id", shopId).maybeSingle(),
    supabase.from("shop_catalog_labels").select("id, kind, name, position").eq("shop_id", shopId),
    supabase.rpc("catalog_label_usage", { p_shop_id: shopId }),
    supabase.from("shop_option_presets").select("name, values, position").eq("shop_id", shopId).order("position"),
  ]);

  for (const r of [shop, govs, fees, priv, notif, labels, usage, presets]) {
    if (r.error) throw new Error(`Could not load settings: ${r.error.message}`);
  }
  if (!shop.data) return null;
  const s = shop.data as unknown as Record<string, unknown>;
  const p = (priv.data ?? {}) as Record<string, unknown>;
  const n = (notif.data ?? {}) as Record<string, unknown>;

  const governorates = (govs.data ?? []).map((g) => g.name as string);
  const feeMap = new Map((fees.data ?? []).map((f) => [f.governorate as string, num(f.fee)]));
  const usageMap = new Map(
    ((usage.data ?? []) as { label_id: string; products: number }[]).map((u) => [u.label_id, Number(u.products)]),
  );

  const labelList: CatalogLabel[] = ((labels.data ?? []) as { id: string; kind: string; name: string; position: number }[])
    .map((l) => ({
      id: l.id,
      kind: l.kind === "category" ? ("category" as const) : ("collection" as const),
      name: l.name,
      position: l.position,
      products: usageMap.get(l.id) ?? 0,
    }))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  const logoPath = (s.logo_path as string | null) ?? null;
  const sharePath = (s.share_image_path as string | null) ?? null;

  return {
    shopId: s.id as string,
    slug: s.slug as string,
    name: s.name as string,
    tagline: (s.tagline as string | null) ?? null,
    heroText: (s.hero_text as string | null) ?? null,
    whatsapp: (s.whatsapp_number as string | null) ?? null,
    instagram: (s.instagram as string | null) ?? null,
    facebook: (s.facebook as string | null) ?? null,
    primaryColor: (s.primary_color as string | null) ?? null,
    accentColor: (s.accent_color as string | null) ?? null,
    logoPath,
    logoUrl: shopAssetUrl(logoPath) ?? ((s.logo_url as string | null) || null),
    description: (s.description as string | null) ?? null,
    shareImagePath: sharePath,
    shareImageUrl: shopAssetUrl(sharePath),
    acceptingOrders: Boolean(s.accepting_orders),
    closedMessage: (s.closed_message as string | null) ?? null,
    minOrder: num(s.min_order_amount),
    maxPieces: Number(s.max_pieces ?? 20),
    deliveryOn: Boolean(s.delivery_on),
    deliveryMode: s.delivery_mode === "governorate" ? "governorate" : "fixed",
    deliveryFixed: Number(s.delivery_fixed ?? 0),
    governorates,
    fees: Object.fromEntries(governorates.map((g) => [g, feeMap.get(g) ?? null])),
    freeOn: Boolean(s.free_delivery_on),
    freeAbove: num(s.free_delivery_above),
    deliveryNote: (s.delivery_note as string | null) ?? null,
    pickupOn: Boolean(s.pickup_on),
    pickupNote: (s.pickup_note as string | null) ?? null,
    descriptionOn: Boolean(s.description_on),
    lowStockAt: Number(s.low_stock_at ?? 3),
    policyOn: Boolean(s.policy_on),
    policyText: (s.policy_text as string | null) ?? null,
    reviewsOn: Boolean(s.reviews_on),
    reviewsNeedApproval: Boolean(s.reviews_need_approval),
    invoicePrefix: (p.invoice_prefix as string) ?? "ORD",
    depositOn: Boolean(p.deposit_on),
    depositType: p.deposit_type === "delivery_fee" ? "delivery_fee" : "fixed",
    depositAmount: num(p.deposit_amount),
    depositInstructions: (p.deposit_instructions as string | null) ?? null,
    templates: {
      confirm: (p.wa_confirm_template as string | null) ?? null,
      deposit: (p.wa_deposit_template as string | null) ?? null,
      review: (p.wa_review_template as string | null) ?? null,
    },
    emailEnabled: Boolean(n.email_enabled),
    orderEmails: (n.order_emails as string[] | null) ?? [],
    labels: labelList,
    presets: ((presets.data ?? []) as { name: string; values: string[] }[]).map((x) => ({ name: x.name, values: x.values })),
  };
}
