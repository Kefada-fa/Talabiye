/**
 * A photo inside a frame (e.g. a 4:5 product card), showing the part the
 * seller chose in "Adjust": focus point (0–100 % across / down) and zoom
 * (1–3). The photo file is never cropped — this is only how it's shown.
 *
 * Shared by the back office (inventory cards, Adjust frame) and the shop
 * page (Step 10), so what the seller sees is what customers see.
 */
export type PhotoFocus = { x: number; y: number; zoom: number };

export const DEFAULT_FOCUS: PhotoFocus = { x: 50, y: 50, zoom: 1 };

export const clampFocus = (f: PhotoFocus): PhotoFocus => ({
  x: Math.min(100, Math.max(0, Math.round(f.x * 100) / 100)),
  y: Math.min(100, Math.max(0, Math.round(f.y * 100) / 100)),
  zoom: Math.min(3, Math.max(1, Math.round(f.zoom * 1000) / 1000)),
});

/** CSS for the <img>: fill the frame, aim at the focus point, zoom around it. */
export function focusStyle(f: PhotoFocus = DEFAULT_FOCUS): React.CSSProperties {
  const pos = `${f.x}% ${f.y}%`;
  return {
    objectFit: "cover",
    objectPosition: pos,
    transform: f.zoom !== 1 ? `scale(${f.zoom})` : undefined,
    transformOrigin: pos,
  };
}

export function FocusedPhoto({
  src,
  alt,
  focus = DEFAULT_FOCUS,
  className = "",
  imgClassName = "",
  loading,
  draggable,
}: {
  src: string;
  alt: string;
  focus?: PhotoFocus;
  className?: string; // the frame: size / aspect ratio / rounding
  imgClassName?: string;
  loading?: "lazy" | "eager";
  draggable?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- storage URLs / local previews */}
      <img
        src={src}
        alt={alt}
        loading={loading}
        draggable={draggable}
        className={`absolute inset-0 h-full w-full select-none ${imgClassName}`}
        style={focusStyle(focus)}
      />
    </div>
  );
}
