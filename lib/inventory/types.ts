// Shapes of the inventory data. Safe for client code.
// Product-neutral: option types are named by the seller.

import type { PhotoFocus } from "@/components/photo/focused-photo";

/** A saved photo; focus = what shows on 4:5 cards (never crops the file). */
export type InvPhoto = { id: string; path: string; url: string; focus: PhotoFocus };

export type InvValue = { id: string; value: string; photoId: string | null };
export type InvType = { id: string; name: string; position: 1 | 2; values: InvValue[] };
export type InvVariant = {
  id: string;
  value1Id: string | null;
  value2Id: string | null;
  label: string;
  stock: number | null; // null = not tracked
  price: number | null; // own price
};

/** One item as the list and the editor see it. */
export type InvItem = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  price: number;
  salePrice: number | null;
  collection: string | null;
  categories: string[];
  isActive: boolean;
  brand: string | null;
  expiryDate: string | null; // YYYY-MM-DD
  barcode: string | null;
  weight: string | null;
  stock: number | null; // items without options
  createdAt: string;
  photos: InvPhoto[];
  types: InvType[];
  variants: InvVariant[];
  cost: number | null; // OWNERS only (always null for staff)
};

export type InventoryData = {
  shopId: string;
  isOwner: boolean;
  lowStockAt: number;
  today: string; // YYYY-MM-DD in Beirut
  maxPhotos: number;
  collections: string[];
  categories: string[];
  presets: { name: string; values: string[] }[]; // favourite option types (Settings)
  items: InvItem[];
};

export type Buyer = {
  orderId: string;
  displayNumber: string;
  status: "unconfirmed" | "pending" | "paid" | "cancelled" | "refused";
  createdAt: string;
  customerName: string | null;
  optionLabel: string | null;
  quantity: number;
};

export type StockChange = {
  id: string;
  createdAt: string;
  optionLabel: string | null;
  from: number | null;
  to: number | null;
  change: number | null;
  reason: "edit" | "quick_stock" | "order_placed" | "order_cancelled" | "order_refused";
  byMe: boolean;
  byCustomer: boolean;
};

export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
