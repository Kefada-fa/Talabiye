import type { Metadata } from "next";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { getDashboardContext } from "@/lib/backoffice/context";
import { getInventory } from "@/lib/inventory/data";
import { PageTitle } from "@/components/backoffice/ui";
import { InventoryList } from "@/components/backoffice/inventory/inventory-list";

const inv = t.backoffice.inventory;

export const metadata: Metadata = { title: inv.title };

export default function InventoryPage() {
  return (
    <div className="flex flex-col">
      <PageTitle title={inv.title} />
      <Suspense fallback={<p className="py-10 text-center text-bo-muted">{t.common.loading}</p>}>
        <InventoryLoader />
      </Suspense>
    </div>
  );
}

async function InventoryLoader() {
  const ctx = await getDashboardContext();
  if (!ctx.current) return null; // the layout shows "No shop yet"
  const data = await getInventory(ctx.current.id, ctx.current.role === "owner");
  // The list keeps its own copy (so quick stock shows at once). The key is a
  // fingerprint of the items: when the server sends a changed list (new,
  // edited or deleted item), the list starts over with the fresh data.
  return <InventoryList key={`${ctx.current.id}:${fingerprint(JSON.stringify(data.items))}`} data={data} />;
}

/** Short fingerprint of a text (changes when the text changes). */
function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
