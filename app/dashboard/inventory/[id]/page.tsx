import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { getDashboardContext } from "@/lib/backoffice/context";
import { formFromItem } from "@/lib/inventory/form";
import { getBuyers, getInventory, getOrderedValueIds, getStockHistory } from "@/lib/inventory/data";
import type { InvItem } from "@/lib/inventory/types";
import { ItemEditor } from "@/components/backoffice/inventory/item-editor";
import { StockHistory, WhoBought } from "@/components/backoffice/inventory/item-extras";

const f = t.backoffice.inventory.form;

export const metadata: Metadata = { title: f.editTitle };

/** Short fingerprint of an item (without photos): when it changes after a
 *  save, the editor starts again from the saved data. */
function version(item: InvItem): string {
  const text = JSON.stringify({ ...item, photos: undefined });
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export default function ItemPage({ params, searchParams }: PageProps<"/dashboard/inventory/[id]">) {
  return (
    <Suspense fallback={<p className="py-10 text-center text-bo-muted">{t.common.loading}</p>}>
      <ItemLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ItemLoader({
  params,
  searchParams,
}: {
  params: PageProps<"/dashboard/inventory/[id]">["params"];
  searchParams: PageProps<"/dashboard/inventory/[id]">["searchParams"];
}) {
  const ctx = await getDashboardContext();
  if (!ctx.current) return null;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const data = await getInventory(ctx.current.id, ctx.current.role === "owner");
  const item = data.items.find((it) => it.id === id);
  if (!item) notFound();

  const [buyers, history, orderedValueIds] = await Promise.all([
    getBuyers(item.id),
    getStockHistory(item.id, ctx.user.id),
    getOrderedValueIds(item.id),
  ]);
  const orderCount = new Set(buyers.map((b) => b.orderId)).size;

  return (
    <div className="flex flex-col gap-5">
      <ItemEditor
        key={version(item)}
        data={data}
        item={item}
        initial={formFromItem(item)}
        orderedValueIds={orderedValueIds}
        orderCount={orderCount}
        duplicated={false}
        flash={typeof sp.saved === "string" ? f.saved : null}
        warning={sp.photos === "failed" ? f.photosUploadFailed : null}
      />
      <WhoBought buyers={buyers} />
      <StockHistory changes={history} />
    </div>
  );
}
