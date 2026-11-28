/**
 * Lebanese MOBILE numbers → "+961XXXXXXX(X)".
 * Same rules as private.normalize_lb_phone() in the database (the database
 * has the final say; this gives instant feedback in the form).
 *
 * Accepted, with or without 961 / +961 / 00961, spaces, dashes or a leading 0:
 *   - 8 digits starting with 70, 71, 76, 78, 79, 81   e.g. 70 123 456
 *   - 7 digits starting with 3 (the "03" numbers)      e.g. 03 123 456
 * Landlines (01, 04, 05…) and anything else → null.
 */
export function normalizeLebanesePhone(input: string): string | null {
  let d = (input ?? "").replace(/[^0-9]/g, "");
  if (!d) return null;

  if (d.startsWith("00961")) d = d.slice(5);
  else if (d.startsWith("961") && d.length >= 10) d = d.slice(3);

  if (d.startsWith("0")) d = d.slice(1);

  return /^(3[0-9]{6}|(70|71|76|78|79|81)[0-9]{6})$/.test(d) ? "+961" + d : null;
}

/** "+96170123456" → "96170123456" (the format wa.me links need). */
export function toWhatsappDigits(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}
