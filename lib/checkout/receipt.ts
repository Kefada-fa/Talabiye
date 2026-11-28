import "server-only";

/**
 * Order receipt for the success page.
 *
 * Created by the checkout server action from place_order's reply and stored
 * in a short-lived, httpOnly cookie that only works on that one order page
 * (/<shop>/order/<number>). The success page shows ONLY what is in the
 * visitor's own cookie — it never reads orders from the database — so
 * typing another order number in the URL shows nothing.
 */

export const RECEIPT_COOKIE = "order_receipt";
export const RECEIPT_MAX_AGE_SECONDS = 30 * 60; // 30 minutes

export type ReceiptLine = {
  name: string;
  option: string | null; // "Flavor: Chocolate"
  quantity: number;
  lineTotal: number;
};

export type Receipt = {
  v: 2;
  slug: string;
  shopName: string;
  whatsapp: string | null;
  orderNumber: number; // used in the URL
  displayNumber: string; // shown to people, e.g. KF-0012
  items: ReceiptLine[];
  moreItems: number; // lines left out to keep the cookie small
  subtotal: number;
  deliveryFee: number;
  freeDelivery: boolean;
  total: number;
  customerName: string;
  method: "pickup" | "delivery";
  place: string | null; // "Beirut, Beirut, Achrafieh"
  paymentMethod: "cod" | "whish";
};

export function receiptPath(slug: string, orderNumber: number) {
  return `/${slug}/order/${orderNumber}`;
}

const MAX_COOKIE_CHARS = 3500; // browsers allow ~4KB per cookie

export function encodeReceipt(receipt: Receipt): string {
  const encode = (r: Receipt) => Buffer.from(JSON.stringify(r), "utf8").toString("base64url");
  let value = encode(receipt);
  // Very large orders: keep the first lines, count the rest.
  const r = { ...receipt, items: [...receipt.items] };
  while (value.length > MAX_COOKIE_CHARS && r.items.length > 1) {
    r.items.pop();
    r.moreItems += 1;
    value = encode(r);
  }
  return value;
}

export function decodeReceipt(value: string | undefined): Receipt | null {
  if (!value) return null;
  try {
    const r = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Receipt;
    if (r?.v !== 2 || typeof r.slug !== "string" || !Number.isInteger(r.orderNumber)) return null;
    if (!Array.isArray(r.items) || typeof r.displayNumber !== "string") return null;
    return r;
  } catch {
    return null;
  }
}
