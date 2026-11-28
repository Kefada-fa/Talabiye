import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { PlaceholderPage } from "@/components/backoffice/placeholder-page";

export const metadata: Metadata = { title: t.backoffice.pages.inventory.title };

export default function Page() {
  const p = t.backoffice.pages.inventory;
  return <PlaceholderPage title={p.title} text={p.text} />;
}
