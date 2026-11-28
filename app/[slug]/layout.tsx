import { Suspense } from "react";
import { brand } from "@/config/brand";
import { fill, t } from "@/lib/i18n";
import { contrastRatio } from "@/lib/settings/contrast";
import { getShopBySlug } from "@/lib/storefront/data";
import type { StoreShop } from "@/lib/storefront/types";
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
  return shop ? (
    <>
      <ShopColors shop={shop} />
      <ShopHeader shop={shop} />
    </>
  ) : null;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * The shop's own colors (Settings → Shop profile) replace the platform's
 * on this shop's pages. Text on the main color is white or near-black,
 * whichever is easier to read. Colors are checked (#RRGGBB) by the
 * database and again here, so nothing else can get into the CSS.
 */
function ShopColors({ shop }: { shop: StoreShop }) {
  const primary = shop.primaryColor && HEX.test(shop.primaryColor) ? shop.primaryColor : null;
  const accent = shop.accentColor && HEX.test(shop.accentColor) ? shop.accentColor : null;
  if (!primary && !accent) return null;

  const vars: string[] = [];
  if (primary) {
    const onPrimary = (contrastRatio(primary, "#FFFFFF") ?? 21) >= (contrastRatio(primary, "#111111") ?? 0) ? "#FFFFFF" : "#111111";
    vars.push(`--brand-primary: ${primary} !important;`, `--brand-on-primary: ${onPrimary} !important;`);
  }
  if (accent) vars.push(`--brand-accent: ${accent} !important;`);
  return <style>{`html { ${vars.join(" ")} }`}</style>;
}
