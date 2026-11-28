/**
 * WhatsApp message templates: placeholders, preview and checks.
 * The real sending (buttons on the invoice page) comes in Step 11, using
 * renderTemplate() with the order's real data.
 */
import { t } from "@/lib/i18n";
import type { TemplateKey } from "./validate";

export const TEMPLATE_PLACEHOLDERS = [
  "name",
  "order_number",
  "total",
  "items",
  "address",
  "deposit",
  "review_link",
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

/** The shop's text, or the default when it has none. */
export function templateText(key: TemplateKey, saved: string | null): string {
  return saved ?? t.backoffice.settings.templates.defaults[key];
}

/** Fills {name}, {total}… Unknown {words} are left as they are. */
export function renderTemplate(text: string, values: Partial<Record<TemplatePlaceholder, string>>): string {
  return text.replace(/\{([^{}\s]+)\}/g, (match, key: string) =>
    (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key) && values[key as TemplatePlaceholder] !== undefined
      ? (values[key as TemplatePlaceholder] as string)
      : match,
  );
}

/** {words} that are not known placeholders, e.g. ["{nme}"]. */
export function unknownPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(m[1])) found.add(m[0]);
  }
  return [...found];
}
