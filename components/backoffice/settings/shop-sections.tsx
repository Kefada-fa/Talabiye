"use client";

import { useState } from "react";
import { brand } from "@/config/brand";
import {
  saveDeliveryAction,
  saveLinkPreviewAction,
  saveOrderingAction,
  savePolicyAction,
  saveProductPageAction,
  saveReviewsAction,
} from "@/app/dashboard/settings/actions";
import { fill, t } from "@/lib/i18n";
import type { ShopSettings } from "@/lib/settings/types";
import {
  validateDelivery,
  validateLinkPreview,
  validateOrdering,
  validatePolicy,
  validateProductPage,
} from "@/lib/settings/validate";
import { ImagePicker, saveImageChoice, type ImageChoice } from "./image-picker";
import { Choice, inputClass, moneyText, Note, SectionCard, TextField, Toggle, useReadOnly, useSection } from "./kit";

const s = t.backoffice.settings;

// ------------------------------------------------------------ link preview
export function LinkPreviewSection({ settings }: { settings: ShopSettings }) {
  const readOnly = useReadOnly();
  const sec = useSection({ description: settings.description ?? "" });
  const [image, setImage] = useState<ImageChoice>({ kind: "keep" });
  const l = s.linkPreview;
  const shownImage = image.kind === "new" ? image.image.url : image.kind === "remove" ? null : settings.shareImageUrl;

  return (
    <SectionCard
      id="link-preview"
      title={l.title}
      intro={l.intro}
      dirty={sec.dirty || image.kind !== "keep"}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() =>
        sec.save(
          async (value) => {
            const img = await saveImageChoice(settings.shopId, "share", image);
            if (!img.ok) return img;
            if (image.kind !== "keep") setImage({ kind: "keep" });
            return saveLinkPreviewAction(value);
          },
          (value) => validateLinkPreview(value).errors,
        )
      }
    >
      <TextField
        label={l.description}
        hint={l.descriptionHint}
        value={sec.value.description}
        onChange={(x) => sec.update("description", x)}
        error={sec.errors.description}
        max={160}
        multiline
        rows={2}
      />
      <ImagePicker
        kind="share"
        label={l.image}
        hint={l.imageHint}
        currentUrl={settings.shareImageUrl}
        choice={image}
        onChange={setImage}
        chooseLabel={l.chooseImage}
        changeLabel={l.changeImage}
        removeLabel={l.removeImage}
        readOnly={readOnly}
      />

      {/* Chat-style preview */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-bo-ink">{l.previewLabel}</span>
        <div className="max-w-sm overflow-hidden rounded-xl border border-bo-border bg-[#e7f6e9]">
          {shownImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview
            <img src={shownImage} alt="" className="aspect-[1200/630] w-full object-cover" />
          ) : (
            <p className="bg-bo-page p-3 text-xs text-bo-muted">{l.noImage}</p>
          )}
          <div className="p-3">
            <p className="text-sm font-semibold text-zinc-900">{settings.name}</p>
            <p className="line-clamp-2 text-xs text-zinc-600">{sec.value.description || settings.tagline || ""}</p>
            <p className="mt-1 text-xs text-zinc-500">{brand.domain}</p>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------- taking orders
export function OrderingSection({ settings }: { settings: ShopSettings }) {
  const o = s.ordering;
  const sec = useSection({
    acceptingOrders: settings.acceptingOrders,
    closedMessage: settings.closedMessage ?? "",
    minOrder: moneyText(settings.minOrder),
    maxPieces: String(settings.maxPieces),
  });
  const v = sec.value;
  return (
    <SectionCard
      id="ordering"
      title={o.title}
      intro={o.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save(saveOrderingAction, (x) => validateOrdering(x).errors)}
    >
      <Toggle label={o.open} hint={o.openHint} checked={v.acceptingOrders} onChange={(x) => sec.update("acceptingOrders", x)} />
      <TextField
        label={o.closedMessage}
        hint={fill(o.closedDefault, { shop: settings.name })}
        placeholder={o.closedPlaceholder}
        value={v.closedMessage}
        onChange={(x) => sec.update("closedMessage", x)}
        error={sec.errors.closedMessage}
        max={200}
        multiline
        rows={2}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField label={o.minOrder} hint={o.minOrderHint} value={v.minOrder} onChange={(x) => sec.update("minOrder", x)} error={sec.errors.minOrder} inputMode="decimal" prefix="$" />
        <TextField label={o.maxPieces} hint={o.maxPiecesHint} value={v.maxPieces} onChange={(x) => sec.update("maxPieces", x)} error={sec.errors.maxPieces} inputMode="numeric" />
      </div>
    </SectionCard>
  );
}

// ------------------------------------------------------- delivery + pickup
export function DeliverySection({ settings }: { settings: ShopSettings }) {
  const d = s.delivery;
  const sec = useSection({
    deliveryOn: settings.deliveryOn,
    mode: settings.deliveryMode,
    fixedFee: moneyText(settings.deliveryFixed),
    fees: Object.fromEntries(settings.governorates.map((g) => [g, moneyText(settings.fees[g])])) as Record<string, string>,
    freeOn: settings.freeOn,
    freeAbove: moneyText(settings.freeAbove),
    deliveryNote: settings.deliveryNote ?? "",
    pickupOn: settings.pickupOn,
    pickupNote: settings.pickupNote ?? "",
  });
  const v = sec.value;
  const e = sec.errors;
  const bothOff = !v.deliveryOn && !v.pickupOn;

  return (
    <SectionCard
      id="delivery"
      title={d.title}
      intro={d.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save(saveDeliveryAction, (x) => validateDelivery(x, settings.governorates).errors)}
    >
      <Toggle label={d.deliveryOn} hint={d.deliveryOnHint} checked={v.deliveryOn} onChange={(x) => sec.update("deliveryOn", x)} />

      {v.deliveryOn && (
        <div className="flex flex-col gap-5 border-l-4 border-bo-border pl-4">
          <Choice
            label={d.feeType}
            value={v.mode}
            onChange={(x) => sec.update("mode", x)}
            options={[
              { value: "fixed", label: d.fixed },
              { value: "governorate", label: d.perGov },
            ]}
          />
          {v.mode === "fixed" ? (
            <TextField label={d.fixedFee} value={v.fixedFee} onChange={(x) => sec.update("fixedFee", x)} error={e.fixedFee} inputMode="decimal" prefix="$" className="max-w-40" />
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-bo-muted">{d.perGovHint}</p>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-bo-muted">
                    <th scope="col" className="py-2 font-semibold">{d.governorate}</th>
                    <th scope="col" className="py-2 font-semibold">{d.fee}</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.governorates.map((g) => {
                    const fee = v.fees[g] ?? "";
                    const err = e[`fee:${g}`];
                    return (
                      <tr key={g} className="border-t border-bo-border align-top">
                        <th scope="row" className="py-2 pr-3 text-base font-medium">{g}</th>
                        <td className="py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex w-32 items-stretch">
                              <span className="inline-flex items-center rounded-l-xl border border-r-0 border-bo-border bg-bo-page px-3 text-bo-muted">$</span>
                              <input
                                aria-label={`${d.fee}: ${g}`}
                                value={fee}
                                inputMode="decimal"
                                onChange={(ev) => sec.update("fees", { ...v.fees, [g]: ev.target.value })}
                                aria-invalid={!!err}
                                className={`${inputClass} rounded-l-none`}
                              />
                            </div>
                            {fee.trim() === "" && (
                              <span className="rounded-full bg-status-cancelled-bg px-2.5 py-1 text-xs font-semibold text-status-cancelled-fg">
                                {d.notAvailable}
                              </span>
                            )}
                          </div>
                          {err && <p className="mt-1 text-sm font-medium text-status-refused-fg">{err}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {e.fees && <p className="text-sm font-medium text-status-refused-fg">{e.fees}</p>}
            </div>
          )}

          <Toggle label={d.freeOn} checked={v.freeOn} onChange={(x) => sec.update("freeOn", x)} />
          {v.freeOn && (
            <TextField label={d.freeAbove} value={v.freeAbove} onChange={(x) => sec.update("freeAbove", x)} error={e.freeAbove} inputMode="decimal" prefix="$" className="max-w-40" />
          )}
          <TextField label={d.deliveryNote} hint={d.deliveryNoteHint} value={v.deliveryNote} onChange={(x) => sec.update("deliveryNote", x)} error={e.deliveryNote} max={160} />
        </div>
      )}

      <Toggle label={d.pickupOn} hint={d.pickupOnHint} checked={v.pickupOn} onChange={(x) => sec.update("pickupOn", x)} />
      {v.pickupOn && (
        <div className="border-l-4 border-bo-border pl-4">
          <TextField label={d.pickupNote} hint={d.pickupNoteHint} value={v.pickupNote} onChange={(x) => sec.update("pickupNote", x)} error={e.pickupNote} max={160} />
        </div>
      )}

      {bothOff && <Note tone="warning">{d.errors.bothOff}</Note>}
    </SectionCard>
  );
}

// ------------------------------------------------------------ product page
export function ProductPageSection({ settings }: { settings: ShopSettings }) {
  const pp = s.productPage;
  const sec = useSection({ descriptionOn: settings.descriptionOn, lowStockAt: String(settings.lowStockAt) });
  const n = Number(sec.value.lowStockAt);
  return (
    <SectionCard
      id="product-page"
      title={pp.title}
      intro={pp.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save(saveProductPageAction, (x) => validateProductPage(x).errors)}
    >
      <Toggle label={pp.descriptionOn} checked={sec.value.descriptionOn} onChange={(x) => sec.update("descriptionOn", x)} />
      <TextField
        label={pp.lowStock}
        hint={pp.lowStockHint}
        value={sec.value.lowStockAt}
        onChange={(x) => sec.update("lowStockAt", x)}
        error={sec.errors.lowStockAt}
        inputMode="numeric"
        className="max-w-28"
      />
      {Number.isInteger(n) && n > 0 && n <= 99 && (
        <Note>{fill(pp.lowStockExample, { text: fill(t.product.onlyLeft, { count: Math.min(n, 2) }) })}</Note>
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------------ policy
export function PolicySection({ settings }: { settings: ShopSettings }) {
  const po = s.policy;
  const sec = useSection({ policyOn: settings.policyOn, policyText: settings.policyText ?? "" });
  const v = sec.value;
  return (
    <SectionCard
      id="policy"
      title={po.title}
      intro={po.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save(savePolicyAction, (x) => validatePolicy(x).errors)}
    >
      <Toggle label={po.on} checked={v.policyOn} onChange={(x) => sec.update("policyOn", x)} />
      <TextField label={po.text} value={v.policyText} onChange={(x) => sec.update("policyText", x)} error={sec.errors.policyText} max={1000} multiline rows={5} />
      {v.policyOn ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-bo-ink">{po.preview}</span>
          {/* Same look as the checkout's policy box */}
          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-zinc-900">
            <h3 className="font-semibold">{t.checkout.policyTitle}</h3>
            <p className="whitespace-pre-line text-sm text-zinc-700">{v.policyText || "…"}</p>
            <span className="flex items-start gap-3 text-sm">
              <span aria-hidden className="mt-0.5 inline-block h-5 w-5 shrink-0 rounded border border-zinc-400" />
              {t.checkout.policyAgree}
            </span>
          </div>
        </div>
      ) : (
        <Note>{po.offNote}</Note>
      )}
    </SectionCard>
  );
}

// ----------------------------------------------------------------- reviews
export function ReviewsSection({ settings }: { settings: ShopSettings }) {
  const r = s.reviews;
  const sec = useSection({ reviewsOn: settings.reviewsOn, needApproval: settings.reviewsNeedApproval });
  return (
    <SectionCard
      id="reviews"
      title={r.title}
      intro={r.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save(saveReviewsAction)}
    >
      <Toggle label={r.on} checked={sec.value.reviewsOn} onChange={(x) => sec.update("reviewsOn", x)} />
      <Toggle label={r.approval} hint={r.approvalHint} checked={sec.value.needApproval} onChange={(x) => sec.update("needApproval", x)} />
    </SectionCard>
  );
}
