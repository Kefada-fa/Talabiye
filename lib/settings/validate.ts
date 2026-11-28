/**
 * Settings validation — the SAME rules run in the browser (instant
 * feedback) and in the server actions (the real check). The database has
 * its own checks too (see migration 20261128160000_settings_page.sql).
 *
 * Every validator returns { value, errors }: `value` is the cleaned data
 * ready to save, `errors` maps a field name to a message (empty = OK).
 */
import { fill, t } from "@/lib/i18n";
import { normalizeLebanesePhone } from "@/lib/phone";

const s = t.backoffice.settings;
export type FieldErrors = Record<string, string>;
type Result<T> = { value: T; errors: FieldErrors };

// ---------------------------------------------------------------- helpers
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown): boolean => v === true;
/** Trimmed text, or null when empty. */
const optText = (v: unknown): string | null => str(v).trim() || null;

function maxLen(errors: FieldErrors, field: string, value: string | null, max: number) {
  if (value && value.length > max) errors[field] = fill(s.errors.tooLong, { max });
}

/** "15", "15.5", "15.50" → 15.5; "" → null; anything else → NaN. */
export function parseMoney(input: unknown): number | null {
  const text = typeof input === "number" ? String(input) : str(input).trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return NaN;
  return Number(text);
}

function money(
  errors: FieldErrors,
  field: string,
  input: unknown,
  { min, max, required }: { min: number; max: number; required: boolean },
): number | null {
  const n = parseMoney(input);
  if (n === null) {
    if (required) errors[field] = s.errors.required;
    return null;
  }
  if (Number.isNaN(n)) errors[field] = s.errors.money;
  else if (n < min || n > max) errors[field] = fill(s.errors.moneyRange, { min, max });
  return Number.isNaN(n) ? null : n;
}

function wholeNumber(errors: FieldErrors, field: string, input: unknown, min: number, max: number): number {
  const text = typeof input === "number" ? String(input) : str(input).trim();
  const n = /^\d{1,4}$/.test(text) ? Number(text) : NaN;
  if (Number.isNaN(n) || n < min || n > max) errors[field] = fill(s.errors.wholeNumber, { min, max });
  return Number.isNaN(n) ? min : n;
}

export const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;
export const FACEBOOK_RE = /^https:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com)\/\S{1,170}$/;
export const PREFIX_RE = /^[A-Z0-9]{2,5}$/;

/** "@kefada.lb" or "https://instagram.com/kefada.lb/" → "kefada.lb". */
export function cleanInstagram(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
}

/** "facebook.com/page" → "https://facebook.com/page". */
export function cleanFacebook(input: string): string {
  const v = input.trim();
  if (!v) return "";
  if (/^http:\/\//i.test(v)) return "https://" + v.slice(7);
  if (/^(www\.|m\.|web\.)?(facebook\.com|fb\.com)\//i.test(v)) return "https://" + v;
  return v;
}

// ---------------------------------------------------------------- sections
export type ProfileInput = {
  name: string;
  tagline: string;
  heroText: string;
  whatsapp: string;
  instagram: string;
  facebook: string;
  primaryColor: string;
  accentColor: string;
};
export type ProfileValue = {
  name: string;
  tagline: string | null;
  hero_text: string | null;
  whatsapp_number: string | null;
  instagram: string | null;
  facebook: string | null;
  primary_color: string | null;
  accent_color: string | null;
};

export function validateProfile(input: Partial<ProfileInput>): Result<ProfileValue> {
  const errors: FieldErrors = {};
  const name = str(input.name).trim();
  if (name.length < 1 || name.length > 100) errors.name = s.profile.errors.name;
  const tagline = optText(input.tagline);
  maxLen(errors, "tagline", tagline, 80);
  const hero = optText(input.heroText);
  maxLen(errors, "heroText", hero, 300);

  let whatsapp: string | null = null;
  if (str(input.whatsapp).trim()) {
    whatsapp = normalizeLebanesePhone(str(input.whatsapp));
    if (!whatsapp) errors.whatsapp = s.profile.errors.whatsapp;
  }
  const instagram = cleanInstagram(str(input.instagram)) || null;
  if (instagram && !INSTAGRAM_RE.test(instagram)) errors.instagram = s.profile.errors.instagram;
  const facebook = cleanFacebook(str(input.facebook)) || null;
  if (facebook && !FACEBOOK_RE.test(facebook)) errors.facebook = s.profile.errors.facebook;

  const color = (field: string, v: unknown) => {
    const c = str(v).trim();
    if (!c) return null;
    if (!HEX_RE.test(c)) errors[field] = s.profile.errors.color;
    return c.toUpperCase();
  };

  return {
    value: {
      name,
      tagline,
      hero_text: hero,
      whatsapp_number: whatsapp,
      instagram,
      facebook,
      primary_color: color("primaryColor", input.primaryColor),
      accent_color: color("accentColor", input.accentColor),
    },
    errors,
  };
}

export function validateLinkPreview(input: { description?: string }): Result<{ description: string | null }> {
  const errors: FieldErrors = {};
  const description = optText(input.description);
  maxLen(errors, "description", description, 160);
  return { value: { description }, errors };
}

export type OrderingInput = { acceptingOrders: boolean; closedMessage: string; minOrder: string; maxPieces: string };
export function validateOrdering(input: Partial<OrderingInput>) {
  const errors: FieldErrors = {};
  const closed = optText(input.closedMessage);
  maxLen(errors, "closedMessage", closed, 200);
  const min = money(errors, "minOrder", input.minOrder, { min: 0.01, max: 100000, required: false });
  const maxPieces = wholeNumber(errors, "maxPieces", input.maxPieces, 1, 50);
  return {
    value: { accepting_orders: bool(input.acceptingOrders), closed_message: closed, min_order_amount: min, max_pieces: maxPieces },
    errors,
  };
}

export type DeliveryInput = {
  deliveryOn: boolean;
  mode: "fixed" | "governorate";
  fixedFee: string;
  fees: Record<string, string>;
  freeOn: boolean;
  freeAbove: string;
  deliveryNote: string;
  pickupOn: boolean;
  pickupNote: string;
};
export function validateDelivery(input: Partial<DeliveryInput>, governorates: string[]) {
  const errors: FieldErrors = {};
  const deliveryOn = bool(input.deliveryOn);
  const pickupOn = bool(input.pickupOn);
  if (!deliveryOn && !pickupOn) errors.form = s.delivery.errors.bothOff;
  const mode = input.mode === "governorate" ? "governorate" : "fixed";

  const fixed = money(errors, "fixedFee", input.fixedFee, { min: 0, max: 1000, required: deliveryOn && mode === "fixed" });
  const fees: Record<string, number | null> = {};
  for (const g of governorates) {
    const n = parseMoney(input.fees?.[g] ?? "");
    if (n !== null && (Number.isNaN(n) || n > 1000)) errors[`fee:${g}`] = s.delivery.errors.fee;
    fees[g] = n === null || Number.isNaN(n) ? null : n;
  }
  if (deliveryOn && mode === "governorate" && Object.values(fees).every((f) => f === null) && !Object.keys(errors).some((k) => k.startsWith("fee:"))) {
    errors.fees = s.delivery.errors.noGovFee;
  }

  const freeOn = bool(input.freeOn);
  const freeAbove = money(errors, "freeAbove", input.freeAbove, { min: 0.01, max: 100000, required: freeOn });
  if (freeOn && freeAbove === null && !errors.freeAbove) errors.freeAbove = s.delivery.errors.freeAbove;

  const deliveryNote = optText(input.deliveryNote);
  maxLen(errors, "deliveryNote", deliveryNote, 160);
  const pickupNote = optText(input.pickupNote);
  maxLen(errors, "pickupNote", pickupNote, 160);

  return {
    value: {
      p_delivery_on: deliveryOn,
      p_delivery_mode: mode,
      p_delivery_fixed: fixed ?? 0,
      p_fees: fees,
      p_free_delivery_on: freeOn,
      p_free_delivery_above: freeAbove,
      p_delivery_note: deliveryNote,
      p_pickup_on: pickupOn,
      p_pickup_note: pickupNote,
    },
    errors,
  };
}

export function validateProductPage(input: { descriptionOn?: boolean; lowStockAt?: string }) {
  const errors: FieldErrors = {};
  const low = wholeNumber(errors, "lowStockAt", input.lowStockAt, 0, 99);
  return { value: { description_on: bool(input.descriptionOn), low_stock_at: low }, errors };
}

export function validatePolicy(input: { policyOn?: boolean; policyText?: string }) {
  const errors: FieldErrors = {};
  const text = optText(input.policyText);
  maxLen(errors, "policyText", text, 1000);
  if (bool(input.policyOn) && !text) errors.policyText = s.policy.errors.text;
  return { value: { policy_on: bool(input.policyOn), policy_text: text }, errors };
}

export function validateReviews(input: { reviewsOn?: boolean; needApproval?: boolean }) {
  return {
    value: { reviews_on: bool(input.reviewsOn), reviews_need_approval: bool(input.needApproval) },
    errors: {} as FieldErrors,
  };
}

export type DepositInput = { depositOn: boolean; type: "fixed" | "delivery_fee"; amount: string; instructions: string };
export function validateDeposits(input: Partial<DepositInput>) {
  const errors: FieldErrors = {};
  const on = bool(input.depositOn);
  const type = input.type === "delivery_fee" ? "delivery_fee" : "fixed";
  const amount = money(errors, "amount", input.amount, { min: 0.01, max: 10000, required: on && type === "fixed" });
  if (errors.amount) errors.amount = s.deposits.errors.amount;
  const instructions = optText(input.instructions);
  maxLen(errors, "instructions", instructions, 300);
  if (on && !instructions) errors.instructions = s.deposits.errors.instructions;
  return {
    value: { deposit_on: on, deposit_type: type, deposit_amount: amount, deposit_instructions: instructions },
    errors,
  };
}

export type TemplateKey = "confirm" | "deposit" | "review";
export const TEMPLATE_KEYS: TemplateKey[] = ["confirm", "deposit", "review"];
export function validateTemplates(input: Partial<Record<TemplateKey, string>>) {
  const errors: FieldErrors = {};
  const out: Record<string, string | null> = {};
  for (const key of TEMPLATE_KEYS) {
    const text = str(input[key]).replace(/\r\n/g, "\n").trim();
    if (!text) errors[key] = s.templates.empty;
    maxLen(errors, key, text, 1000);
    // Same as the default → store nothing (null = default, so later
    // improvements to the default text reach this shop too).
    out[key] = text === s.templates.defaults[key] ? null : text || null;
  }
  return {
    value: { wa_confirm_template: out.confirm, wa_deposit_template: out.deposit, wa_review_template: out.review },
    errors,
  };
}

export function validateEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function validateNotifications(input: { emailEnabled?: boolean; emails?: unknown }) {
  const errors: FieldErrors = {};
  const emails = Array.isArray(input.emails) ? input.emails.map((e) => str(e).trim()).filter(Boolean) : [];
  if (emails.length > 3) errors.emails = s.notifications.errors.max;
  else if (emails.some((e) => !validateEmail(e))) errors.emails = s.notifications.errors.email;
  else if (new Set(emails.map((e) => e.toLowerCase())).size !== emails.length) errors.emails = s.notifications.errors.duplicate;
  else if (bool(input.emailEnabled) && emails.length === 0) errors.emails = s.notifications.errors.needOne;
  return { value: { email_enabled: bool(input.emailEnabled), order_emails: emails }, errors };
}

export function validatePrefix(input: { prefix?: string }) {
  const errors: FieldErrors = {};
  const prefix = str(input.prefix).trim().toUpperCase();
  if (!PREFIX_RE.test(prefix)) errors.prefix = s.invoices.errors.prefix;
  return { value: { invoice_prefix: prefix }, errors };
}

export function validateLabelName(name: string, others: string[]): string | null {
  const v = name.trim();
  if (v.length < 1 || v.length > 50) return s.lists.errors.name;
  if (others.some((o) => o.toLowerCase() === v.toLowerCase())) return s.lists.errors.duplicate;
  return null;
}

export type PresetInput = { name: string; values: string[] };
export function validatePresets(input: unknown) {
  const errors: FieldErrors = {};
  const list: PresetInput[] = Array.isArray(input)
    ? input.slice(0, 31).map((p) => ({
        name: str((p as PresetInput)?.name).trim(),
        values: Array.isArray((p as PresetInput)?.values) ? (p as PresetInput).values.map((v) => str(v).trim()) : [],
      }))
    : [];
  if (list.length > 30) errors.form = s.presets.errors.tooMany;
  const names = new Set<string>();
  list.forEach((p, i) => {
    if (p.name.length < 1 || p.name.length > 50) errors[`name:${i}`] = s.presets.errors.name;
    else if (names.has(p.name.toLowerCase())) errors[`name:${i}`] = s.presets.errors.duplicateName;
    names.add(p.name.toLowerCase());
    if (p.values.length === 0) errors[`values:${i}`] = s.presets.errors.noValues;
    else if (p.values.length > 50) errors[`values:${i}`] = s.presets.errors.tooManyValues;
    else if (p.values.some((v) => v.length < 1 || v.length > 50)) errors[`values:${i}`] = s.presets.errors.value;
    else if (new Set(p.values.map((v) => v.toLowerCase())).size !== p.values.length)
      errors[`values:${i}`] = s.presets.errors.duplicateValue;
  });
  return { value: list, errors };
}

export function validatePasswordChange(input: { current?: string; next?: string; repeat?: string }) {
  const errors: FieldErrors = {};
  const a = s.account.errors;
  const current = str(input.current);
  const next = str(input.next);
  if (!current) errors.current = s.errors.required;
  if (next.length < 8) errors.next = a.short;
  else if (next.length > 72) errors.next = fill(s.errors.tooLong, { max: 72 });
  else if (next === current) errors.next = a.same;
  if (str(input.repeat) !== next) errors.repeat = a.mismatch;
  return { value: { current, next }, errors };
}

export const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;
