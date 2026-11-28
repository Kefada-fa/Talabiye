"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { t } from "@/lib/i18n";
import { normalizeLebanesePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { getShopBySlug, isValidSlug } from "@/lib/storefront/data";
import { MAX_CART_LINES, MAX_QTY_PER_ITEM } from "@/lib/storefront/types";
import { checkFormToken } from "@/lib/checkout/form-token";
import {
  RECEIPT_COOKIE,
  RECEIPT_MAX_AGE_SECONDS,
  encodeReceipt,
  receiptPath,
  type Receipt,
} from "@/lib/checkout/receipt";
import { processOutbox } from "@/lib/notifications/outbox";

export type StockProblem = {
  productId: string;
  variantId: string | null;
  product: string;
  option: string | null;
  requested: number;
  available: number;
};

/** A price that changed since the item was put in the cart. */
export type PriceChange = {
  productId: string;
  variantId: string | null;
  product: string;
  option: string | null;
  oldPrice: number;
  newPrice: number;
  listPrice: number;
};

export type CheckoutState = { error: string | null; stockProblems?: StockProblem[]; priceChanges?: PriceChange[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// expected_price = the unit price the customer saw in the cart; place_order
// refuses (saves nothing) if the real price is different.
type OrderItemInput = { product_id: string; variant_id: string | null; quantity: number; expected_price?: number };

/** Turns the cart sent by the browser into place_order's item list (or null). */
function parseCart(raw: FormDataEntryValue | null): OrderItemInput[] | null {
  if (typeof raw !== "string" || raw.length > 20_000) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0 || data.length > MAX_CART_LINES) return null;
    const items: OrderItemInput[] = [];
    for (const entry of data) {
      const e = entry as Record<string, unknown>;
      const productId = e?.productId;
      const variantId = e?.variantId ?? null;
      const quantity = e?.quantity;
      if (typeof productId !== "string" || !UUID_RE.test(productId)) return null;
      if (variantId !== null && (typeof variantId !== "string" || !UUID_RE.test(variantId))) return null;
      if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_QTY_PER_ITEM) return null;
      const price = e?.unitPrice;
      if (price !== undefined && (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1000000)) return null;
      items.push({
        product_id: productId,
        variant_id: variantId as string | null,
        quantity: quantity as number,
        ...(typeof price === "number" ? { expected_price: Math.round(price * 100) / 100 } : {}),
      });
    }
    return items;
  } catch {
    return null;
  }
}

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Database errors → a message safe to show the customer. */
function friendlyError(error: { code?: string; message?: string }): string {
  // place_order raises its own clear, customer-friendly messages as P0001.
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "22023") return t.checkout.errors.phone; // not a Lebanese mobile
  console.error("[checkout] place_order failed:", error);
  return t.checkout.errors.generic;
}

type PlaceOrderReply =
  | {
      ok: false;
      error: "stock" | "prices";
      message: string;
      price_changes?: {
        product_id: string;
        variant_id: string | null;
        product: string;
        option: string | null;
        old_price: number;
        new_price: number;
        list_price: number;
      }[];
      stock_problems: {
        product_id: string;
        variant_id: string | null;
        product: string;
        option: string | null;
        requested: number;
        available: number;
      }[];
    }
  | {
      ok: true;
      order_id: string;
      order_number: number;
      display_number: string;
      items: { name: string; option_label: string | null; quantity: number; line_total: number }[];
      subtotal: number;
      delivery_fee: number;
      free_delivery: boolean;
      total: number;
      customer_name: string;
      method: "pickup" | "delivery";
      governorate: string | null;
      district: string | null;
      city: string | null;
      payment_method: "cod" | "whish";
    };

/**
 * Checkout form → place_order (server-only, in the database) → success page.
 * Anyone can post to this action, so everything is checked here AND again
 * in the database.
 */
export async function placeOrderAction(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const slug = text(formData, "slug");
  if (!isValidSlug(slug)) return { error: t.checkout.errors.generic };

  // ---- Spam checks (only possible here, before the database) ----
  // 1. Honeypot: people never see or fill this field; simple bots do.
  if (text(formData, "website") !== "") return { error: t.checkout.errors.generic };
  // 2. Signed timestamp: filled in under 4 seconds = refuse.
  const tokenCheck = checkFormToken(text(formData, "form_token"), Date.now());
  if (tokenCheck === "too_fast") return { error: t.checkout.errors.tooFast };
  if (tokenCheck === "expired") return { error: t.checkout.errors.expired };
  if (tokenCheck !== "ok") return { error: t.checkout.errors.generic };

  // ---- Form fields (checked again in the database) ----
  const name = text(formData, "name");
  const phone = normalizeLebanesePhone(text(formData, "phone"));
  const method = text(formData, "method");
  const governorate = text(formData, "governorate");
  const district = text(formData, "district");
  const city = text(formData, "city");
  const neighbourhood = text(formData, "neighbourhood");
  const street = text(formData, "street");
  const details = text(formData, "details");
  const notes = text(formData, "notes");
  const policyAccepted = formData.get("policy") === "on";

  if (!name) return { error: t.checkout.errors.name };
  if (!phone) return { error: t.checkout.errors.phone };
  if (method !== "pickup" && method !== "delivery") return { error: t.checkout.errors.method };
  if (method === "delivery") {
    if (!governorate) return { error: t.checkout.errors.governorate };
    if (!district) return { error: t.checkout.errors.district };
    if (!city) return { error: t.checkout.errors.city };
    if (!street) return { error: t.checkout.errors.street };
  }
  if (
    name.length > 100 || city.length > 100 || neighbourhood.length > 100 ||
    street.length > 200 || details.length > 500 || notes.length > 2000
  ) {
    return { error: t.checkout.errors.tooLong };
  }

  const items = parseCart(formData.get("cart"));
  if (!items) return { error: t.checkout.errors.emptyCart };

  const shop = await getShopBySlug(slug);
  if (!shop) return { error: t.checkout.errors.generic };
  if (shop.policyOn && !policyAccepted) return { error: t.checkout.errors.policy };

  // place_order is SERVER-ONLY: it needs the admin (secret) key.
  const admin = createAdminClient();
  if (!admin) {
    console.error("[checkout] SUPABASE_SECRET_KEY is not set — cannot place orders.");
    return { error: t.checkout.errors.notConfigured };
  }

  const isDelivery = method === "delivery";
  const { data, error } = await admin.rpc("place_order", {
    p_shop_slug: slug,
    p_customer_name: name,
    p_customer_phone: phone,
    p_method: method,
    p_governorate: isDelivery ? governorate : null,
    p_district: isDelivery ? district : null,
    p_city: isDelivery ? city : null,
    p_neighbourhood: isDelivery ? neighbourhood || null : null,
    p_street: isDelivery ? street : null,
    p_details: isDelivery ? details || null : null,
    p_notes: notes || null,
    p_items: items,
    p_policy_accepted: policyAccepted,
  });
  if (error) return { error: friendlyError(error) };

  const reply = data as PlaceOrderReply;

  // Not enough stock and/or prices changed: nothing was saved. Send the
  // lists back so the customer can fix the cart with one tap.
  if (!reply.ok) {
    const priceChanges = (reply.price_changes ?? []).map((p) => ({
      productId: p.product_id,
      variantId: p.variant_id,
      product: p.product,
      option: p.option,
      oldPrice: Number(p.old_price),
      newPrice: Number(p.new_price),
      listPrice: Number(p.list_price),
    }));
    return {
      error: priceChanges.length > 0 && reply.stock_problems.length === 0 ? t.checkout.pricesChangedTitle : reply.message,
      priceChanges,
      stockProblems: reply.stock_problems.map((p) => ({
        productId: p.product_id,
        variantId: p.variant_id,
        product: p.product,
        option: p.option,
        requested: p.requested,
        available: p.available,
      })),
    };
  }

  const receipt: Receipt = {
    v: 2,
    slug: shop.slug,
    shopName: shop.name,
    whatsapp: shop.whatsappNumber,
    orderNumber: reply.order_number,
    displayNumber: reply.display_number,
    items: reply.items.map((i) => ({
      name: i.name,
      option: i.option_label,
      quantity: i.quantity,
      lineTotal: Number(i.line_total),
    })),
    moreItems: 0,
    subtotal: Number(reply.subtotal),
    deliveryFee: Number(reply.delivery_fee),
    freeDelivery: Boolean(reply.free_delivery),
    total: Number(reply.total),
    customerName: reply.customer_name,
    method: reply.method,
    place: reply.method === "delivery"
      ? [reply.city, reply.district, reply.governorate].filter(Boolean).join(", ")
      : null,
    paymentMethod: reply.payment_method,
  };

  const path = receiptPath(shop.slug, reply.order_number);
  (await cookies()).set(RECEIPT_COOKIE, encodeReceipt(receipt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path,
    maxAge: RECEIPT_MAX_AGE_SECONDS,
  });

  // Send the shop's notifications AFTER the customer gets their page.
  // If sending fails, the order is already saved and the outbox keeps the
  // message for a retry — the customer never sees an error.
  after(async () => {
    try {
      await processOutbox();
    } catch (e) {
      console.error("[notifications] sending after checkout failed:", e);
    }
  });

  redirect(path);
}
