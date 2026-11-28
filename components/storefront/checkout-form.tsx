"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { placeOrderAction, type CheckoutState } from "@/app/[slug]/checkout/actions";
import { useCart } from "@/lib/cart/cart";
import { formatPrice } from "@/lib/format";
import { fill, t } from "@/lib/i18n";
import { normalizeLebanesePhone } from "@/lib/phone";
import type { DeliveryArea, StoreShop } from "@/lib/storefront/types";
import { OrderTotals } from "./cart-view";

const initialState: CheckoutState = { error: null };

type Field = "name" | "phone" | "governorate" | "district" | "city" | "street" | "policy";
type FieldErrors = Partial<Record<Field, string>>;

const inputClass =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20";

export function CheckoutForm({
  shop,
  areas,
  formToken,
}: {
  shop: StoreShop;
  areas: DeliveryArea[];
  formToken: string;
}) {
  const slug = shop.slug;
  const { items, hydrated, subtotal, applyStockProblems } = useCart(slug);
  const [state, formAction, pending] = useActionState(placeOrderAction, initialState);

  // Controlled fields, so nothing is lost if the server returns an error.
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"delivery" | "pickup">(shop.deliveryOn ? "delivery" : "pickup");
  const [governorate, setGovernorate] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");
  const [neighbourhood, setNeighbourhood] = useState("");
  const [street, setStreet] = useState("");
  const [details, setDetails] = useState("");
  const [notes, setNotes] = useState("");
  const [policy, setPolicy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [cartFixed, setCartFixed] = useState(false);

  if (!hydrated) {
    return <p className="py-10 text-center text-zinc-500">{t.common.loading}</p>;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-zinc-600">{cartFixed ? t.checkout.cartFixed : t.cart.empty}</p>
        <Link href={`/${slug}`} className="rounded-full bg-brand-primary px-6 py-3 font-semibold text-brand-on-primary">
          {t.cart.continueShopping}
        </Link>
      </div>
    );
  }

  // Delivery fee estimate (the database decides the real one).
  const area = areas.find((a) => a.governorate === governorate);
  const freeDelivery =
    method === "delivery" && shop.freeDeliveryOn && shop.freeDeliveryAbove !== null && subtotal >= shop.freeDeliveryAbove;
  const deliveryFee =
    method === "pickup" ? 0 : freeDelivery ? 0 : area && area.fee !== null ? area.fee : null;

  // Only ids + quantities are sent; the database looks up real prices.
  const cartPayload = JSON.stringify(
    items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
  );

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = t.checkout.errors.name;
    if (!normalizeLebanesePhone(phone)) errors.phone = t.checkout.errors.phone;
    if (method === "delivery") {
      if (!governorate) errors.governorate = t.checkout.errors.governorate;
      if (!district) errors.district = t.checkout.errors.district;
      if (!city.trim()) errors.city = t.checkout.errors.city;
      if (!street.trim()) errors.street = t.checkout.errors.street;
    }
    if (shop.policyOn && !policy) errors.policy = t.checkout.errors.policy;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) e.preventDefault(); // stop before sending
    else setCartFixed(false);
  }

  const stockProblems = state.stockProblems ?? [];

  return (
    <form action={formAction} onSubmit={validate} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="cart" value={cartPayload} />
      <input type="hidden" name="form_token" value={formToken} />

      {/* Honeypot: hidden from people, tempting for bots. Must stay empty. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          {t.checkout.honeypotLabel}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      {/* ---- Your details ---- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.checkout.yourDetails}</h2>
        <Field id="name" label={t.checkout.name} error={fieldErrors.name}>
          <input id="name" name="name" autoComplete="name" required maxLength={100}
            value={name} onChange={(e) => setName(e.target.value)}
            className={inputClass} aria-invalid={!!fieldErrors.name} />
        </Field>
        <Field id="phone" label={t.checkout.phone} hint={t.checkout.phoneHint} error={fieldErrors.phone}>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={20}
            value={phone} onChange={(e) => setPhone(e.target.value)}
            onBlur={() => {
              const n = normalizeLebanesePhone(phone);
              if (n) setPhone(n); // show the cleaned-up +961 number
            }}
            className={inputClass} aria-invalid={!!fieldErrors.phone} />
        </Field>
      </section>

      {/* ---- Pickup or delivery ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.checkout.howToGet}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {shop.deliveryOn && (
            <Choice name="method" value="delivery" checked={method === "delivery"}
              onChange={() => setMethod("delivery")} title={t.checkout.delivery} hint={t.checkout.deliveryHint} />
          )}
          {shop.pickupOn && (
            <Choice name="method" value="pickup" checked={method === "pickup"}
              onChange={() => setMethod("pickup")} title={t.checkout.pickup} hint={t.checkout.pickupHint} />
          )}
        </div>
        {!shop.deliveryOn && <p className="text-sm text-zinc-500">{t.checkout.deliveryNotAvailable}</p>}
        {method === "delivery" && shop.deliveryNote && <p className="text-sm text-zinc-500">{shop.deliveryNote}</p>}
      </section>

      {method === "delivery" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t.checkout.address}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="governorate" label={t.checkout.governorate} error={fieldErrors.governorate}>
              <select id="governorate" name="governorate" value={governorate}
                onChange={(e) => { setGovernorate(e.target.value); setDistrict(""); }}
                className={inputClass} aria-invalid={!!fieldErrors.governorate}>
                <option value="">{t.checkout.chooseGovernorate}</option>
                {areas.map((a) => (
                  <option key={a.governorate} value={a.governorate} disabled={a.fee === null}>
                    {a.fee === null ? fill(t.checkout.notDelivered, { name: a.governorate }) : a.governorate}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="district" label={t.checkout.district} error={fieldErrors.district}>
              <select id="district" name="district" value={district} disabled={!area}
                onChange={(e) => setDistrict(e.target.value)}
                className={inputClass} aria-invalid={!!fieldErrors.district}>
                <option value="">{t.checkout.chooseDistrict}</option>
                {(area?.districts ?? []).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field id="city" label={t.checkout.city} hint={t.checkout.cityHint} error={fieldErrors.city}>
            <input id="city" name="city" autoComplete="address-level2" maxLength={100}
              value={city} onChange={(e) => setCity(e.target.value)}
              className={inputClass} aria-invalid={!!fieldErrors.city} />
          </Field>
          <Field id="neighbourhood" label={t.checkout.neighbourhood}>
            <input id="neighbourhood" name="neighbourhood" maxLength={100}
              value={neighbourhood} onChange={(e) => setNeighbourhood(e.target.value)} className={inputClass} />
          </Field>
          <Field id="street" label={t.checkout.street} error={fieldErrors.street}>
            <input id="street" name="street" autoComplete="address-line1" maxLength={200}
              value={street} onChange={(e) => setStreet(e.target.value)}
              className={inputClass} aria-invalid={!!fieldErrors.street} />
          </Field>
          <Field id="details" label={t.checkout.details}>
            <textarea id="details" name="details" maxLength={500} rows={2}
              value={details} onChange={(e) => setDetails(e.target.value)} className={inputClass} />
          </Field>
        </section>
      )}

      <Field id="notes" label={t.checkout.notes} hint={t.checkout.notesHint}>
        <textarea id="notes" name="notes" maxLength={2000} rows={2}
          value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </Field>

      {/* ---- Payment ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.checkout.payment}</h2>
        <div className="rounded-xl border-2 border-brand-primary bg-white p-4">
          <span className="block font-medium">{t.checkout.cod}</span>
          <span className="block text-sm text-zinc-500">{t.checkout.codHint}</span>
        </div>
      </section>

      {/* ---- Summary ---- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.checkout.summary}</h2>
        <ul className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          {items.map((i) => (
            <li key={`${i.productId}:${i.variantId ?? ""}`} className="flex justify-between gap-3">
              <span className="min-w-0">
                {i.quantity} × {i.name}
                {i.optionText && <span className="text-zinc-500"> — {i.optionText}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{formatPrice(i.unitPrice * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <OrderTotals subtotal={subtotal} deliveryFee={deliveryFee} free={freeDelivery} hideDelivery={method === "pickup"} />
        {method === "delivery" && shop.freeDeliveryOn && shop.freeDeliveryAbove !== null && !freeDelivery && (
          <p className="text-sm text-zinc-500">
            {fill(t.checkout.freeDeliveryHint, { amount: formatPrice(shop.freeDeliveryAbove) })}
          </p>
        )}
      </section>

      {/* ---- Policy ---- */}
      {shop.policyOn && (
        <section className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold">{t.checkout.policyTitle}</h2>
          {shop.policyText && <p className="whitespace-pre-line text-sm text-zinc-600">{shop.policyText}</p>}
          <label className="mt-1 flex items-start gap-3 text-sm">
            <input type="checkbox" name="policy" checked={policy} onChange={(e) => setPolicy(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-brand-primary" aria-invalid={!!fieldErrors.policy} />
            <span>{t.checkout.policyAgree}</span>
          </label>
          {fieldErrors.policy && <p className="text-sm text-red-600">{fieldErrors.policy}</p>}
        </section>
      )}

      {/* ---- Errors from the server ---- */}
      <div aria-live="assertive">
        {cartFixed ? (
          <p className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700">{t.checkout.cartFixed}</p>
        ) : stockProblems.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">{t.checkout.stockTitle}</p>
            <ul className="list-disc pl-5">
              {stockProblems.map((p) => {
                const label = p.option ? `${p.product} (${p.option})` : p.product;
                return (
                  <li key={`${p.productId}:${p.variantId ?? ""}`}>
                    {p.available > 0
                      ? fill(t.checkout.stockLine, { name: label, requested: p.requested, available: p.available })
                      : fill(t.checkout.stockLineSoldOut, { name: label })}
                  </li>
                );
              })}
            </ul>
            <button type="button"
              onClick={() => { applyStockProblems(stockProblems); setCartFixed(true); }}
              className="self-start rounded-full bg-red-700 px-4 py-2 font-semibold text-white">
              {t.checkout.fixCart}
            </button>
          </div>
        ) : (
          state.error && (
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>
          )
        )}
      </div>

      <button type="submit" disabled={pending}
        className="h-12 w-full rounded-full bg-brand-primary text-base font-semibold text-brand-on-primary disabled:opacity-60">
        {pending ? t.checkout.placing : t.checkout.placeOrder}
      </button>
    </form>
  );
}

function Choice({
  name, value, checked, onChange, title, hint,
}: {
  name: string; value: string; checked: boolean; onChange: () => void; title: string; hint: string;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 bg-white p-4 ${checked ? "border-brand-primary" : "border-zinc-200"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-1 accent-brand-primary" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-zinc-500">{hint}</span>
      </span>
    </label>
  );
}

function Field({
  id, label, hint, error, children,
}: {
  id: string; label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-zinc-800">{label}</label>
      {children}
      {error ? <p className="text-sm text-red-600">{error}</p> : hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
