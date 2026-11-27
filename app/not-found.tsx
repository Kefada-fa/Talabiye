import Link from "next/link";
import { t } from "@/lib/i18n";

/** Friendly 404 for any unknown URL. */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <h1 className="text-xl font-semibold">{t.notFound.title}</h1>
      <p className="text-zinc-600">{t.notFound.text}</p>
      <Link href="/" className="mt-2 text-sm font-medium text-brand-primary underline underline-offset-4">
        {t.notFound.home}
      </Link>
    </main>
  );
}
