import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { SETTINGS_BASE, SETTINGS_SECTIONS } from "@/lib/settings/sections";
import { PageTitle } from "@/components/backoffice/ui";

const s = t.backoffice.settings;

export const metadata: Metadata = { title: s.title };

/**
 * Settings home: the list of sections. On a computer the same list is also
 * in the sidebar (under Settings); on a phone this is the menu.
 */
export default function SettingsHome() {
  return (
    <div className="flex flex-col">
      <PageTitle title={s.title} subtitle={s.chooseSection} />
      <p className="mb-4 text-bo-muted md:hidden">{s.chooseSection}</p>
      <ul className="overflow-hidden rounded-bo-card border border-bo-border bg-bo-card">
        {SETTINGS_SECTIONS.map((section, i) => (
          <li key={section.slug} className={i > 0 ? "border-t border-bo-border" : ""}>
            <Link
              href={`${SETTINGS_BASE}/${section.slug}`}
              className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 hover:bg-bo-page"
            >
              <span className="min-w-0">
                <span className="block font-semibold text-bo-ink">{section.label}</span>
                <span className="block truncate text-sm text-bo-muted">{section.intro}</span>
              </span>
              <span aria-hidden className="text-xl text-bo-muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
