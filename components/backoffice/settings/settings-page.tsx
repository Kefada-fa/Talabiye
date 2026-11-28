"use client";

import { t } from "@/lib/i18n";
import type { SettingsSectionSlug } from "@/lib/settings/sections";
import type { ShopSettings } from "@/lib/settings/types";
import { AccountSection } from "./account-section";
import { Note, SettingsProvider } from "./kit";
import { CatalogListsSection, PresetsSection } from "./list-sections";
import { DepositsSection, InvoicesSection, NotificationsSection, TemplatesSection } from "./order-sections";
import { ProfileSection } from "./profile-section";
import {
  DeliverySection,
  LinkPreviewSection,
  OrderingSection,
  PolicySection,
  ProductPageSection,
  ReviewsSection,
} from "./shop-sections";

const s = t.backoffice.settings;

const VIEWS: Record<Exclude<SettingsSectionSlug, "account">, React.ComponentType<{ settings: ShopSettings }>> = {
  profile: ProfileSection,
  "link-preview": LinkPreviewSection,
  ordering: OrderingSection,
  delivery: DeliverySection,
  "product-page": ProductPageSection,
  policy: PolicySection,
  reviews: ReviewsSection,
  deposits: DepositsSection,
  whatsapp: TemplatesSection,
  notifications: NotificationsSection,
  invoices: InvoicesSection,
  lists: CatalogListsSection,
  "option-types": PresetsSection,
};

/** ONE settings section (its own page). */
export function SettingsSectionView({
  section,
  settings,
  readOnly,
  email,
}: {
  section: SettingsSectionSlug;
  settings: ShopSettings;
  readOnly: boolean;
  email: string | null;
}) {
  if (section === "account") return <AccountSection email={email} />;
  const View = VIEWS[section];
  return (
    <SettingsProvider readOnly={readOnly}>
      <div className="flex flex-col gap-4">
        {readOnly && <Note tone="warning">{s.readOnly}</Note>}
        <View settings={settings} />
      </div>
    </SettingsProvider>
  );
}
