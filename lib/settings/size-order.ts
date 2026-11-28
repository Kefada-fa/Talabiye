/**
 * "Smart size order" for option values:
 *   newborn → months (0-3M, 3M, 6M…) → years (2Y, 3Y…) → letter sizes
 *   (XXS, XS, S, M, L, XL, XXL, 3XL…) → numbers (36, 38…) → everything
 *   else in its current order.
 * Works for any option, but only reorders values it recognises.
 */
const LETTERS = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"];

type Key = [group: number, n: number];

function sizeKey(raw: string): Key | null {
  const v = raw.trim().toUpperCase().replace(/\s+/g, " ");

  if (/^(NB|NEWBORN|NEW BORN|0M|PREEMIE|PREMATURE)$/.test(v)) return [0, 0];

  // Months: "3M", "3 M", "3 MONTHS", "0-3M", "3-6 MONTHS"
  let m = /^(\d{1,2})(?:\s?-\s?(\d{1,2}))?\s?(M|MO|MOS|MONTH|MONTHS)$/.exec(v);
  if (m) return [1, Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0)];

  // Years: "2Y", "2 Y", "2 YEARS", "2-3Y", "2T" (toddler)
  m = /^(\d{1,2})(?:\s?-\s?(\d{1,2}))?\s?(Y|YR|YRS|YEAR|YEARS|T|ANS?)$/.exec(v);
  if (m) return [2, Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0)];

  // Letters, including "2XL" / "3XL" style
  const x = /^(\d)XL$/.exec(v);
  const letter = x ? `${"X".repeat(Number(x[1]))}L` : v;
  const i = LETTERS.indexOf(letter);
  if (i >= 0) return [3, i];

  // Plain numbers (shoe or EU sizes)
  if (/^\d{1,3}(\.5)?$/.test(v)) return [4, Number(v)];

  return null;
}

export function smartSizeSort(values: string[]): string[] {
  return values
    .map((value, index) => ({ value, index, key: sizeKey(value) }))
    .sort((a, b) => {
      const ka = a.key ?? [9, a.index];
      const kb = b.key ?? [9, b.index];
      return ka[0] - kb[0] || ka[1] - kb[1] || a.index - b.index;
    })
    .map((x) => x.value);
}
