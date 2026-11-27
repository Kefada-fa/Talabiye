import Link from "next/link";
import { t } from "@/lib/i18n";

/** Friendly 404 for unknown/inactive shops and products. */
export default function ShopNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <p className="text-5xl" aria-hidden>
        🛍️
      </p>
      <h1 className="text-xl font-semibold">{t.shop.notFoundTitle}</h1>
      <p className="max-w-sm text-zinc-600">{t.shop.notFoundText}</p>
      <Link href="/" className="mt-2 text-sm font-medium text-brand-primary underline underline-offset-4">
        {t.notFound.home}
      </Link>
    </div>
  );
}
