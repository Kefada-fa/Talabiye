/**
 * BRAND CONFIG — the ONLY place the product's branding lives.
 *
 * "Talabiye" is a temporary working name. To rename the product,
 * edit this file only. Never hard-code the brand name, tagline,
 * logo path, or brand colors anywhere else in the code, and never
 * use the brand name in database table or column names.
 */
export const brand = {
  /** Product name shown in the UI, page titles, emails, etc. */
  name: "Talabiye",

  /** Short line shown under the name. */
  tagline: "Take orders from your Instagram & WhatsApp customers — cash on delivery.",

  /** Public site domain. Shop storefronts live at `${domain}/shopname`. */
  domain: "talabiye.com",

  /** Logo files live in /public. Paths are relative to the site root. */
  logo: {
    src: "/logo.svg",
    alt: "Talabiye logo",
  },

  /**
   * Brand colors. These become Tailwind classes automatically:
   *   primary   → bg-brand-primary, text-brand-primary, border-brand-primary
   *   accent    → bg-brand-accent, text-brand-accent, ...
   *   onPrimary → text-brand-on-primary (text color on top of primary)
   */
  colors: {
    primary: "#0E7C4A",
    accent: "#F59E0B",
    onPrimary: "#FFFFFF",
  },
} as const;

export type Brand = typeof brand;
