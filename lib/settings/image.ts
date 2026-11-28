/**
 * Browser-only: shrinks a picture before upload.
 *   - "logo":  fits inside 512 × 512 (keeps its shape)
 *   - "share": cropped to exactly 1200 × 630 (link previews)
 * Output: WebP (JPEG if the browser can't make WebP), under 300 KB.
 */
import { t } from "@/lib/i18n";

export const MAX_ASSET_BYTES = 300 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPT_ATTR = ACCEPTED.join(",");
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

export type PreparedImage = { blob: Blob; ext: "webp" | "jpg"; type: string; url: string };

export class ImageError extends Error {}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImage(file: File, kind: "logo" | "share"): Promise<PreparedImage> {
  const m = t.backoffice.settings.image;
  if (!ACCEPTED.includes(file.type)) throw new ImageError(m.badType);
  if (file.size > MAX_INPUT_BYTES) throw new ImageError(m.tooBig);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageError(m.cantRead);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError(m.cantRead);

  if (kind === "logo") {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } else {
    // Cover-crop to 1200 × 630 (keep the middle).
    canvas.width = 1200;
    canvas.height = 630;
    const scale = Math.max(1200 / bitmap.width, 630 / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1200, 630);
    ctx.drawImage(bitmap, (1200 - w) / 2, (630 - h) / 2, w, h);
  }
  bitmap.close();

  for (const type of ["image/webp", "image/jpeg"]) {
    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      const blob = await toBlob(canvas, type, quality);
      if (!blob || blob.type !== type) break; // this browser can't make this type
      if (blob.size <= MAX_ASSET_BYTES) {
        return { blob, type, ext: type === "image/webp" ? "webp" : "jpg", url: URL.createObjectURL(blob) };
      }
    }
  }
  throw new ImageError(m.cantShrink);
}
