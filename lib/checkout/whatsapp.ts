import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import { toWhatsappDigits } from "@/lib/phone";
import type { Receipt } from "./receipt";

/** The pre-filled WhatsApp message the customer sends to the shop. */
export function buildWhatsappMessage(r: Receipt): string {
  const m = t.order.whatsappMessage;
  const lines = [
    fill(m.greeting, { shop: r.shopName, number: r.orderNumber }),
    ...r.items.map((i) =>
      fill(m.line, { qty: i.quantity, name: i.name, total: formatPrice(i.lineTotal) }),
    ),
    ...(r.moreItems > 0 ? [`• … +${r.moreItems}`] : []),
    "",
    fill(m.total, { total: formatPrice(r.total), fee: formatPrice(r.deliveryFee) }),
    fill(m.name, { name: r.customerName }),
    ...(r.area ? [fill(m.area, { area: r.area })] : []),
    fill(m.payment, { method: t.paymentMethods[r.paymentMethod] }),
  ];
  return lines.join("\n");
}

/** https://wa.me/<number>?text=<message>, or null if the shop has no number. */
export function buildWhatsappLink(r: Receipt): string | null {
  if (!r.whatsapp) return null;
  const digits = toWhatsappDigits(r.whatsapp);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(buildWhatsappMessage(r))}`;
}
