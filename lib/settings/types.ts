// Shape of everything the Settings page shows. Safe for client code.

export type CatalogLabel = {
  id: string;
  kind: "collection" | "category";
  name: string;
  position: number;
  products: number; // how many products use it
};

export type OptionPreset = { name: string; values: string[] };

export type ShopSettings = {
  shopId: string;
  slug: string;
  // profile
  name: string;
  tagline: string | null;
  heroText: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  logoPath: string | null;
  logoUrl: string | null;
  // link preview
  description: string | null;
  shareImagePath: string | null;
  shareImageUrl: string | null;
  // taking orders
  acceptingOrders: boolean;
  closedMessage: string | null;
  minOrder: number | null;
  maxPieces: number;
  // delivery + pickup
  deliveryOn: boolean;
  deliveryMode: "fixed" | "governorate";
  deliveryFixed: number;
  governorates: string[];
  fees: Record<string, number | null>;
  freeOn: boolean;
  freeAbove: number | null;
  deliveryNote: string | null;
  pickupOn: boolean;
  pickupNote: string | null;
  // product page, policy, reviews
  descriptionOn: boolean;
  lowStockAt: number;
  policyOn: boolean;
  policyText: string | null;
  reviewsOn: boolean;
  reviewsNeedApproval: boolean;
  // private (members only)
  invoicePrefix: string;
  depositOn: boolean;
  depositType: "fixed" | "delivery_fee";
  depositAmount: number | null;
  depositInstructions: string | null;
  templates: { confirm: string | null; deposit: string | null; review: string | null };
  emailEnabled: boolean;
  orderEmails: string[];
  // lists
  labels: CatalogLabel[];
  presets: OptionPreset[];
};

/** What every save action returns. */
export type SaveResult = { ok: true; message?: string } | { ok: false; error?: string; fieldErrors?: Record<string, string> };
