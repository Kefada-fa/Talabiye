import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { getDashboardContext } from "@/lib/backoffice/context";
import { getShopSettings } from "@/lib/backoffice/settings";
import { findSettingsSection, SETTINGS_BASE } from "@/lib/settings/sections";
import { PageTitle } from "@/components/backoffice/ui";
import { SettingsSectionView } from "@/components/backoffice/settings/settings-page";

const s = t.backoffice.settings;

export async function generateMetadata({ params }: PageProps<"/dashboard/settings/[section]">): Promise<Metadata> {
  const section = findSettingsSection((await params).section);
  return { title: section ? `${section.label} · ${s.title}` : s.title };
}

/** One settings section, e.g. /dashboard/settings/delivery. */
export default function SettingsSectionPage({ params }: PageProps<"/dashboard/settings/[section]">) {
  return (
    <div className="flex flex-col">
      {/* Phone: back to the list of sections */}
      <Link href={SETTINGS_BASE} className="mb-2 inline-flex min-h-11 w-fit items-center font-semibold text-bo-accent md:hidden">
        ← {s.title}
      </Link>
      <Suspense fallback={<p className="py-10 text-center text-bo-muted">{t.common.loading}</p>}>
        <SectionLoader params={params} />
      </Suspense>
    </div>
  );
}

async function SectionLoader({ params }: { params: PageProps<"/dashboard/settings/[section]">["params"] }) {
  const section = findSettingsSection((await params).section);
  if (!section) notFound();

  const ctx = await getDashboardContext();
  if (!ctx.current) return null; // the layout shows "No shop yet"
  // Read with the user's own session: members can read, only owners can save.
  const settings = await getShopSettings(ctx.current.id);
  if (!settings) return null;

  return (
    <>
      <PageTitle title={s.title} subtitle={s.subtitle} />
      <SettingsSectionView
        // Another shop chosen in the switcher → start fresh.
        key={`${settings.shopId}:${section.slug}`}
        section={section.slug}
        settings={settings}
        readOnly={ctx.current.role !== "owner"}
        email={ctx.user.email}
      />
    </>
  );
}
