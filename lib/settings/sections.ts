import { t } from "@/lib/i18n";

/**
 * The Settings sub-sections, in menu order. Each one is its own page:
 * /dashboard/settings/<slug>. Used by the sidebar dropdown, the phone list
 * and the section pages, so they always match.
 */
const s = t.backoffice.settings;

export const SETTINGS_SECTIONS = [
  { slug: "profile", label: s.profile.title, intro: s.profile.intro },
  { slug: "link-preview", label: s.linkPreview.title, intro: s.linkPreview.intro },
  { slug: "ordering", label: s.ordering.title, intro: s.ordering.intro },
  { slug: "delivery", label: s.delivery.title, intro: s.delivery.intro },
  { slug: "product-page", label: s.productPage.title, intro: s.productPage.intro },
  { slug: "policy", label: s.policy.title, intro: s.policy.intro },
  { slug: "reviews", label: s.reviews.title, intro: s.reviews.intro },
  { slug: "deposits", label: s.deposits.title, intro: s.deposits.intro },
  { slug: "whatsapp", label: s.templates.title, intro: s.templates.intro },
  { slug: "notifications", label: s.notifications.title, intro: s.notifications.intro },
  { slug: "invoices", label: s.invoices.title, intro: s.invoices.intro },
  { slug: "lists", label: s.lists.title, intro: s.lists.intro },
  { slug: "option-types", label: s.presets.title, intro: s.presets.intro },
  { slug: "account", label: s.account.title, intro: s.account.intro },
] as const;

export type SettingsSectionSlug = (typeof SETTINGS_SECTIONS)[number]["slug"];

export const SETTINGS_BASE = "/dashboard/settings";

export function findSettingsSection(slug: string) {
  return SETTINGS_SECTIONS.find((x) => x.slug === slug) ?? null;
}
