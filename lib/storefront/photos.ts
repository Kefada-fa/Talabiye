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
