"use client";

import type { PreparedImage } from "@/lib/settings/image";
import { createClient } from "@/lib/supabase/client";
import { PRODUCT_PHOTOS_BUCKET } from "@/lib/storefront/photos";

/**
 * Uploads prepared photos into "<shop>/<product>/<new random name>" with
 * the user's own login (storage rules: members of that shop only).
 * All or nothing: if one upload fails, the ones already uploaded are
 * deleted again and the error is thrown.
 */
export async function uploadProductPhotos(shopId: string, productId: string, images: PreparedImage[]): Promise<string[]> {
  const supabase = createClient();
  const done: string[] = [];
  for (const img of images) {
    const path = `${shopId}/${productId}/${crypto.randomUUID()}.${img.ext}`;
    const { error } = await supabase.storage
      .from(PRODUCT_PHOTOS_BUCKET)
      .upload(path, img.blob, { contentType: img.type, cacheControl: "31536000", upsert: false });
    if (error) {
      await removeUploaded(done);
      throw new Error(error.message);
    }
    done.push(path);
  }
  return done;
}

/** Deletes files that were uploaded but not saved (no orphans in storage). */
export async function removeUploaded(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const supabase = createClient();
  await supabase.storage.from(PRODUCT_PHOTOS_BUCKET).remove(paths);
}
