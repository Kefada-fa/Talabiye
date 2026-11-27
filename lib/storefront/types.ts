// Shapes of the public catalog data used by the storefront.
// Safe to import from both server and client code.

export type StoreShop = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  whatsappNumber: string | null;
  deliveryFee: number;
};

export type StoreVariant = {
  id: string;
  label: string;
  stock: number | null; // null = not tracked (unlimited)
  priceOverride: number | null;
};

export type StoreProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  optionLabel: string | null; // e.g. "Size", "Flavor"
  stock: number | null; // for products without options; null = unlimited
  variants: StoreVariant[]; // sorted for display
};

/** Most of one item a customer can order (same limit as the database). */
export const MAX_QTY_PER_ITEM = 20;
/** Most different lines in one cart (same limit as the database). */
export const MAX_CART_LINES = 30;
