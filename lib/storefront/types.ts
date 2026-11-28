// Shapes of the public catalog data used by the storefront.
// Safe to import from both server and client code.
// Product-neutral: option types are named by the seller (Size, Flavor, Color…).

export type StoreShop = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  whatsappNumber: string | null;
  deliveryOn: boolean;
  deliveryMode: "fixed" | "governorate";
  deliveryFixed: number;
  freeDeliveryOn: boolean;
  freeDeliveryAbove: number | null;
  deliveryNote: string | null;
  descriptionOn: boolean;
  policyOn: boolean;
  policyText: string | null;
  lowStockAt: number;
  heroText: string | null;
};

export type StoreOptionValue = { id: string; value: string };

/** "Size", "Flavor", "Color"… with its values in the seller's order. */
export type StoreOptionType = {
  id: string;
  name: string;
  position: 1 | 2;
  values: StoreOptionValue[];
};

/** One combination of option values (1 or 2), with its own stock / price. */
export type StoreVariant = {
  id: string;
  value1Id: string | null;
  value2Id: string | null;
  label: string; // "4Y" or "Red / M"
  stock: number | null; // null = not tracked (unlimited)
  priceOverride: number | null; // the option's own price wins
};

export type StoreProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  salePrice: number | null;
  photos: string[]; // full URLs, in order
  code: string | null;
  brand: string | null;
  weight: string | null;
  expiryDate: string | null; // YYYY-MM-DD
  stock: number | null; // for products without options; null = unlimited
  optionTypes: StoreOptionType[]; // 0, 1 or 2
  variants: StoreVariant[];
};

/** A governorate for the checkout dropdowns (fee = null → no delivery there). */
export type DeliveryArea = {
  governorate: string;
  districts: string[];
  fee: number | null;
};

/** Most of one item a customer can order (same limit as the database). */
export const MAX_QTY_PER_ITEM = 20;
/** Most pieces in one order (same limit as the database). */
export const MAX_PIECES_PER_ORDER = 20;
/** Most different lines in one cart (same limit as the database). */
export const MAX_CART_LINES = 30;
