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
  // After a quick-stock change the list stays as it is; reopening the page reloads it.
  return <InventoryList key={ctx.current.id} data={data} />;
}
