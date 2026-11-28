import type { Metadata } from "next";
import { Suspense } from "react";
import { fill, t } from "@/lib/i18n";
import { getDashboardContext } from "@/lib/backoffice/context";
import { emptyForm, formFromItem } from "@/lib/inventory/form";
import { getInventory } from "@/lib/inventory/data";
import { ItemEditor } from "@/components/backoffice/inventory/item-editor";

const f = t.backoffice.inventory.form;

export const metadata: Metadata = { title: f.newTitle };

/** Add an item — or a DUPLICATE of one (?from=<id>). */
export default function NewItemPage({ searchParams }: PageProps<"/dashboard/inventory/new">) {
  return (
    <Suspense fallback={<p className="py-10 text-center text-bo-muted">{t.common.loading}</p>}>
      <NewItemLoader searchParams={searchParams} />
    </Suspense>
  );
}

async function NewItemLoader({ searchParams }: { searchParams: PageProps<"/dashboard/inventory/new">["searchParams"] }) {
  const ctx = await getDashboardContext();
  if (!ctx.current) return null;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const data = await getInventory(ctx.current.id, ctx.current.role === "owner");

  const from = one(sp.from);
  const source = from ? data.items.find((it) => it.id === from) : undefined;
  const id = crypto.randomUUID(); // the new item's id (photos go in its folder)
  const initial = source ? formFromItem(source, { duplicateAs: id }) : emptyForm(id);
  const added = one(sp.added);

  return (
    <ItemEditor
      // Every visit to this page starts with a fresh form.
      key={`${from ?? ""}:${one(sp.n) ?? ""}:${added ?? ""}`}
      data={data}
      item={null}
      initial={initial}
      orderedValueIds={[]}
      orderCount={0}
      duplicated={!!source}
      flash={added ? fill(f.addedOne, { name: added }) : null}
      warning={one(sp.photos) === "failed" ? f.photosUploadFailed : null}
    />
  );
}
