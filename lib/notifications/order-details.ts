import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDetails } from "./types";

/**
 * Loads one order with its shop, customer and items, using the ADMIN client
 * (these tables are private). Simple separate queries — easy to read.
 */
export async function loadOrderDetails(
  admin: SupabaseClient,
  orderId: string,
): Promise<OrderDetails> {
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(
      "id, order_number, shop_id, customer_id, subtotal, delivery_fee, total, " +
        "delivery_area, delivery_address, notes, payment_method",
    )
    .eq("id", orderId)
    .single();
  if (orderError || !order) throw new Error(`order ${orderId} not found: ${orderError?.message}`);

  const o = order as unknown as {
    id: string;
    order_number: number;
    shop_id: string;
    customer_id: string;
    subtotal: number | string;
    delivery_fee: number | string;
    total: number | string;
    delivery_area: string | null;
    delivery_address: string;
    notes: string | null;
    payment_method: "cod" | "whish";
  };

  const [shopRes, customerRes, itemsRes] = await Promise.all([
    admin.from("shops").select("name, slug").eq("id", o.shop_id).single(),
    admin.from("customers").select("name, phone").eq("id", o.customer_id).single(),
    admin
      .from("order_items")
      .select("name_snapshot, price_snapshot, quantity, created_at")
      .eq("order_id", o.id)
      .order("created_at"),
  ]);
  if (shopRes.error) throw new Error(`shop: ${shopRes.error.message}`);
  if (customerRes.error) throw new Error(`customer: ${customerRes.error.message}`);
  if (itemsRes.error) throw new Error(`items: ${itemsRes.error.message}`);

  return {
    orderId: o.id,
    orderNumber: o.order_number,
    shopName: shopRes.data.name,
    shopSlug: shopRes.data.slug,
    customerName: customerRes.data.name,
    customerPhone: customerRes.data.phone,
    area: o.delivery_area,
    address: o.delivery_address,
    notes: o.notes,
    paymentMethod: o.payment_method,
    items: (itemsRes.data ?? []).map((i) => ({
      name: i.name_snapshot,
      quantity: i.quantity,
      unitPrice: Number(i.price_snapshot),
      lineTotal: Number(i.price_snapshot) * i.quantity,
    })),
    subtotal: Number(o.subtotal),
    deliveryFee: Number(o.delivery_fee),
    total: Number(o.total),
  };
}
