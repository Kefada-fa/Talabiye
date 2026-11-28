/**
 * Turns a product_photos.storage_path into a URL the browser can load.
 *   - full "https://…" addresses are used as they are;
 *   - anything else is a path in the Supabase Storage bucket
 *     "product-photos" (bucket + uploads come in a later step).
 */
export const PRODUCT_PHOTOS_BUCKET = "product-photos";

export function photoUrl(storagePath: string): string {
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const path = storagePath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${PRODUCT_PHOTOS_BUCKET}/${path}`;
}

/**
 * Shop pictures (logo, link-preview image) in the public Supabase Storage
 * bucket "shop-assets". Paths look like "<shop id>/logo-<random>.webp";
 * only the shop's owners can upload there (storage rules).
 */
export const SHOP_ASSETS_BUCKET = "shop-assets";

export function shopAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const clean = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${SHOP_ASSETS_BUCKET}/${clean}`;
}
