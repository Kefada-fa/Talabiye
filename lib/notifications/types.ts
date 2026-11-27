/** One row of public.notification_outbox. */
export type OutboxRow = {
  id: string;
  created_at: string;
  shop_id: string;
  order_id: string;
  event_type: "order.created";
  channel: "email" | "push";
  recipient: string; // email address, or device_push_tokens.id for push
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  claimed_at: string | null;
  sent_at: string | null;
};

/** Everything a new-order message needs. */
export type OrderDetails = {
  orderId: string;
  orderNumber: number;
  shopName: string;
  shopSlug: string;
  customerName: string;
  customerPhone: string;
  area: string | null;
  address: string;
  notes: string | null;
  paymentMethod: "cod" | "whish";
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
};

/** Max attempts per message (same as claim_notifications in the database). */
export const MAX_ATTEMPTS = 3;
