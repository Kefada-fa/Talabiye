import { Suspense } from "react";
import { brand } from "@/config/brand";
import { fill, t } from "@/lib/i18n";
import { getShopBySlug } from "@/lib/storefront/data";
import { ShopHeader, ShopHeaderSkeleton } from "@/components/storefront/shop-header";

/**
 * Frame for every page of one shop: the shop's own header, the page, and a
 * small "Powered by <platform>" footer.
 * The URL slug is read inside <Suspense> (required with Cache Components).
 */
export default function ShopLayout({ children, params }: LayoutProps<"/[slug]">) {
  return (
    <div dir={t.dir} className="flex min-h-full flex-1 flex-col bg-zinc-50 text-zinc-900">
      <Suspense fallback={<ShopHeaderSkeleton />}>
        <HeaderLoader params={params} />
      </Suspense>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>

      <footer className="py-6 text-center text-xs text-zinc-400">
        {fill(t.common.poweredBy, { brand: brand.name })}
      </footer>
    </div>
  );
}

async function HeaderLoader({ params }: { params: LayoutProps<"/[slug]">["params"] }) {
  const { slug } = await params;
  const shop = await getShopBySlug(slug);
  // Unknown shop: no header; the page itself shows the friendly 404.
  return shop ? <ShopHeader shop={shop} /> : null;
}
