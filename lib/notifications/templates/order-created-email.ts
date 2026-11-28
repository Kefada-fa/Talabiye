import { brand } from "@/config/brand";
import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import type { OrderDetails } from "../types";

/** Escapes text typed by customers so it can't break or inject into the email HTML. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Back-office link for an order (the invoice page).
 * Set APP_URL in .env.local (e.g. your live domain).
 */
export function orderBackOfficeUrl(orderId: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/dashboard/invoices/${orderId}`;
}

export function buildOrderCreatedEmail(order: OrderDetails): {
  subject: string;
  text: string;
  html: string;
} {
  const e = t.emails.orderCreated;
  const total = formatPrice(order.total);
  const link = orderBackOfficeUrl(order.orderId);
  const payment = t.paymentMethods[order.paymentMethod];

  const method = order.method === "pickup" ? e.pickup : e.deliveryMethod;
  const deliveryText =
    order.method === "pickup" ? null : order.deliveryFee === 0 ? e.free : formatPrice(order.deliveryFee);
  const itemLabel = (i: OrderDetails["items"][number]) => (i.option ? `${i.name} (${i.option})` : i.name);

  const subject = fill(e.subject, {
    number: order.displayNumber,
    customer: order.customerName,
    total,
  });

  // ---- Plain-text version ----
  const text = [
    fill(e.heading, { number: order.displayNumber }),
    fill(e.intro, { shop: order.shopName }),
    "",
    `${e.items}:`,
    ...order.items.map((i) => `- ${i.quantity} × ${itemLabel(i)} — ${formatPrice(i.lineTotal)}`),
    "",
    `${e.subtotal}: ${formatPrice(order.subtotal)}`,
    ...(deliveryText ? [`${e.delivery}: ${deliveryText}`] : []),
    `${e.total}: ${total}`,
    "",
    `${e.customer}:`,
    `${e.name}: ${order.customerName}`,
    `${e.phone}: ${order.customerPhone}`,
    `${e.method}: ${method}`,
    ...(order.address ? [`${e.address}: ${order.address}`] : []),
    `${e.notes}: ${order.notes ?? "-"}`,
    `${e.payment}: ${payment}`,
    "",
    `${e.openOrder}: ${link}`,
    "",
    fill(e.footer, { shop: order.shopName }),
  ].join("\n");

  // ---- HTML version (simple, works in all email apps) ----
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#71717a;vertical-align:top">${esc(label)}</td>` +
    `<td style="padding:4px 0;color:#18181b">${esc(value)}</td></tr>`;

  const itemRows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #e4e4e7">${i.quantity} × ${esc(i.name)}` +
        (i.option ? `<br><span style="color:#71717a;font-size:13px">${esc(i.option)}</span>` : "") +
        `</td>` +
        `<td style="padding:6px 0;border-bottom:1px solid #e4e4e7;text-align:right;white-space:nowrap">${esc(formatPrice(i.lineTotal))}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:24px">
<tr><td>
  <h1 style="margin:0 0 4px;font-size:22px;color:${brand.colors.primary}">${esc(fill(e.heading, { number: order.displayNumber }))}</h1>
  <p style="margin:0 0 20px;color:#52525b">${esc(fill(e.intro, { shop: order.shopName }))}</p>

  <h2 style="margin:0 0 8px;font-size:15px;color:#18181b">${esc(e.items)}</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#18181b">
    ${itemRows}
    <tr><td style="padding:6px 0;color:#71717a">${esc(e.subtotal)}</td><td style="padding:6px 0;text-align:right">${esc(formatPrice(order.subtotal))}</td></tr>
    ${deliveryText ? `<tr><td style="padding:2px 0;color:#71717a">${esc(e.delivery)}</td><td style="padding:2px 0;text-align:right">${esc(deliveryText)}</td></tr>` : ""}
    <tr><td style="padding:8px 0;font-weight:bold">${esc(e.total)}</td><td style="padding:8px 0;text-align:right;font-weight:bold">${esc(total)}</td></tr>
  </table>

  <h2 style="margin:20px 0 8px;font-size:15px;color:#18181b">${esc(e.customer)}</h2>
  <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">
    ${row(e.name, order.customerName)}
    ${row(e.phone, order.customerPhone)}
    ${row(e.method, method)}
    ${order.address ? row(e.address, order.address) : ""}
    ${row(e.notes, order.notes ?? "-")}
    ${row(e.payment, payment)}
  </table>

  <p style="margin:24px 0 0">
    <a href="${esc(link)}" style="display:inline-block;background:${brand.colors.primary};color:${brand.colors.onPrimary};text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">${esc(e.openOrder)}</a>
  </p>
  <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa">${esc(fill(e.footer, { shop: order.shopName }))}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
