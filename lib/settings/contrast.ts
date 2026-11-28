/**
 * Color contrast (WCAG 2): how easy text is to read on a background.
 * 4.5 or more = fine for normal text.
 */
function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => channel(parseInt(x, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast between two colors, e.g. 4.53; null if a color is invalid. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const MIN_CONTRAST = 4.5;
