import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { brand } from "@/config/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Full links in link previews (og:url…) are built from APP_URL.
  metadataBase: new URL((process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")),
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.tagline,
  icons: { icon: brand.logo.src },
};

// Brand colors from config/brand.ts, exposed as CSS variables
// so Tailwind classes like bg-brand-primary can use them.
const brandColorVars = {
  "--brand-primary": brand.colors.primary,
  "--brand-accent": brand.colors.accent,
  "--brand-on-primary": brand.colors.onPrimary,
} as CSSProperties;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      style={brandColorVars}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
