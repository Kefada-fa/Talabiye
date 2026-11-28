import { t } from "@/lib/i18n";
import { ComingSoonCard, PageTitle } from "./ui";

/** A back-office page that only has a title + "coming later" card for now. */
export function PlaceholderPage({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={title} />
      {children}
      <ComingSoonCard label={t.backoffice.pages.comingSoon} text={text} />
    </div>
  );
}
