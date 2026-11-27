"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { t } from "@/lib/i18n";
import { normalizeLebanesePhone } from "@/lib/phone";
import { createPublicClient } from "@/lib/supabase/public";
import { getShopBySlug, isValidSlug } from "@/lib/storefront/data";
import { MAX_CART_LINES, MAX_QTY_PER_ITEM } from "@/lib/storefront/types";
import {
  RECEIPT_COOKIE,
  RECEIPT_MAX_AGE_SECONDS,
  encodeReceipt,
  receiptPath,
  type Receipt,
} from "@/lib/checkout/receipt";
import { processOutbox } from "@/lib/notifications/outbox";

export type CheckoutState = { error: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OrderItemInput = { product_id: string; variant_id: string | null; quantity: number };

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
      items.push({ product_id: productId, variant_id: variantId as string | null, quantity: quantity as number });
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
  // place_order raises its own clear messages ("Only 2 left of …") as P0001.
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "22023") return t.checkout.errors.phone; // invalid phone
  console.error("[checkout] place_order failed:", error);
  return t.checkout.errors.generic;
}

type PlaceOrderReply = {
  order_id: string;
  order_number: number;
  items: { name: string; quantity: number; unit_price: number; line_total: number }[];
  subtotal: number;
  delivery_fee: number;
  total: number;
  customer_name: string;
  delivery_area: string | null;
  payment_method: "cod" | "whish";
};

/**
 * Checkout form → place_order (in the database) → success page.
 * Anyone can call this (it's a public form), so everything is re-checked
 * here and again in the database.
 */
export async function placeOrderAction(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const slug = text(formData, "slug");
  if (!isValidSlug(slug)) return { error: t.checkout.errors.generic };

  // Honeypot: real people never see or fill this field; simple bots do.
  if (text(formData, "website") !== "") return { error: t.checkout.errors.generic };

  const name = text(formData, "name");
  const phone = normalizeLebanesePhone(text(formData, "phone"));
  const area = text(formData, "area");
  const address = text(formData, "address");
  const notes = text(formData, "notes");

  if (!name) return { error: t.checkout.errors.name };
  if (!phone) return { error: t.checkout.errors.phone };
  if (!address) return { error: t.checkout.errors.address };
  if (name.length > 100 || area.length > 100 || address.length > 500 || notes.length > 2000) {
    return { error: t.checkout.errors.tooLong };
  }

  const items = parseCart(formData.get("cart"));
  if (!items) return { error: t.checkout.errors.emptyCart };

  const shop = await getShopBySlug(slug);
  if (!shop) return { error: t.checkout.errors.generic };

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("place_order", {
    p_shop_slug: slug,
    p_customer_name: name,
    p_customer_phone: phone,
    p_customer_area: area,
    p_customer_address: address,
    p_items: items,
    p_notes: notes || null,
    p_payment_method: "cod", // only cash on delivery for now
  });
  if (error) return { error: friendlyError(error) };

  const reply = data as PlaceOrderReply;
  const receipt: Receipt = {
    v: 1,
    slug: shop.slug,
    shopName: shop.name,
    whatsapp: shop.whatsappNumber,
    orderNumber: reply.order_number,
    items: reply.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      lineTotal: Number(i.line_total),
    })),
    moreItems: 0,
    subtotal: Number(reply.subtotal),
    deliveryFee: Number(reply.delivery_fee),
    total: Number(reply.total),
    customerName: reply.customer_name,
    area: reply.delivery_area,
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
