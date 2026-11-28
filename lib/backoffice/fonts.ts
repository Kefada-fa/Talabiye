import { Inter, Space_Grotesk } from "next/font/google";

/**
 * Back-office fonts (approved D1 design): Space Grotesk for headings,
 * Inter for body text. Add `backofficeFontVars` to a wrapper element,
 * then use the Tailwind classes `font-bo-heading` / `font-bo-body`.
 */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const backofficeFontVars = `${spaceGrotesk.variable} ${inter.variable}`;
