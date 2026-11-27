/**
 * Lebanese phone numbers → "+961XXXXXXX(X)".
 * Same rules as private.normalize_lb_phone() in the database (the database
 * has the final say; this is for instant feedback in the form).
 *
 *   "03 123 456"     → "+9613123456"
 *   "70-123-456"     → "+96170123456"
 *   "+961 70 123456" → "+96170123456"
 *   "00961 3 123456" → "+9613123456"
 *   "+961 03 123456" → "+9613123456"
 *
 * Returns null when the number isn't valid.
 */
export function normalizeLebanesePhone(input: string): string | null {
  let d = (input ?? "").replace(/[^0-9]/g, "");
  if (!d) return null;

  if (d.startsWith("00961")) d = d.slice(2);
  else if (d.startsWith("961") && d.length >= 10) {
    // already has the country code
  } else if (d.startsWith("0")) d = "961" + d.slice(1);
  else d = "961" + d;

  if (d.startsWith("9610")) d = "961" + d.slice(4);

  return /^961[0-9]{7,8}$/.test(d) ? "+" + d : null;
}

/** "+96170123456" → "96170123456" (the format wa.me links need). */
export function toWhatsappDigits(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}
