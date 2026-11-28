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
  displayNumber: string; // e.g. KF-0012
  shopName: string;
  shopSlug: string;
  customerName: string;
  customerPhone: string;
  method: "pickup" | "delivery";
  address: string | null; // "Street, Neighbourhood, City, District, Governorate — details"
  notes: string | null;
  paymentMethod: "cod" | "whish";
  items: { name: string; option: string | null; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
};

/** Max attempts per message (same as claim_notifications in the database). */
export const MAX_ATTEMPTS = 3;
