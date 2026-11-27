"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { placeOrderAction, type CheckoutState } from "@/app/[slug]/checkout/actions";
import { useCart } from "@/lib/cart/cart";
import { formatPrice } from "@/lib/format";
import { t } from "@/lib/i18n";
import { normalizeLebanesePhone } from "@/lib/phone";
import { OrderTotals } from "./cart-view";

const initialState: CheckoutState = { error: null };

type FieldErrors = Partial<Record<"name" | "phone" | "address", string>>;

const inputClass =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20";

export function CheckoutForm({ slug, deliveryFee }: { slug: string; deliveryFee: number }) {
  const { items, hydrated, subtotal } = useCart(slug);
  const [state, formAction, pending] = useActionState(placeOrderAction, initialState);

  // Controlled fields, so nothing is lost if the server returns an error.
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  if (!hydrated) {
    return <p className="py-10 text-center text-zinc-500">{t.common.loading}</p>;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-zinc-600">{t.cart.empty}</p>
        <Link href={`/${slug}`} className="rounded-full bg-brand-primary px-6 py-3 font-semibold text-brand-on-primary">
          {t.cart.continueShopping}
        </Link>
      </div>
    );
  }

  // Only ids + quantities are sent; the database looks up real prices.
  const cartPayload = JSON.stringify(
    items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
  );

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = t.checkout.errors.name;
    if (!normalizeLebanesePhone(phone)) errors.phone = t.checkout.errors.phone;
    if (!address.trim()) errors.address = t.checkout.errors.address;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) e.preventDefault(); // stop before sending
  }

  return (
    <form action={formAction} onSubmit={validate} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="cart" value={cartPayload} />

      {/* Honeypot: hidden from people, tempting for bots. Must stay empty. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          {t.checkout.honeypotLabel}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.checkout.yourDetails}</h2>

        <Field id="name" label={t.checkout.name} error={fieldErrors.name}>
          <input
            id="name" name="name" autoComplete="name" required maxLength={100}
            value={name} onChange={(e) => setName(e.target.value)}
            className={inputClass} aria-invalid={!!fieldErrors.name}
          />
        </Field>

        <Field id="phone" label={t.checkout.phone} hint={t.checkout.phoneHint} error={fieldErrors.phone}>
          <input
            id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={20}
            value={phone} onChange={(e) => setPhone(e.target.value)}
            onBlur={() => {
              const n = normalizeLebanesePhone(phone);
              if (n) setPhone(n); // show the cleaned-up +961 number
            }}
            className={inputClass} aria-invalid={!!fieldErrors.phone}
          />
        </Field>

        <Field id="area" label={t.checkout.area} hint={t.checkout.areaHint}>
          <input
            id="area" name="area" autoComplete="address-level2" maxLength={100}
            value={area} onChange={(e) => setArea(e.target.value)} className={inputClass}
          />
        </Field>

        <Field id="address" label={t.checkout.address} hint={t.checkout.addressHint} error={fieldErrors.address}>
          <textarea
            id="address" name="address" autoComplete="street-address" required maxLength={500} rows={3}
            value={address} onChange={(e) => setAddress(e.target.value)}
            className={inputClass} aria-invalid={!!fieldErrors.address}
          />
        </Field>

        <Field id="notes" label={t.checkout.notes} hint={t.checkout.notesHint}>
          <textarea
            id="notes" name="notes" maxLength={2000} rows={2}
            value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.checkout.payment}</h2>
        <label className="flex items-start gap-3 rounded-xl border-2 border-brand-primary bg-white p-4">
          <input type="radio" name="payment" value="cod" defaultChecked className="mt-1 accent-brand-primary" />
          <span>
            <span className="block font-medium">{t.checkout.cod}</span>
            <span className="block text-sm text-zinc-500">{t.checkout.codHint}</span>
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.checkout.summary}</h2>
        <ul className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          {items.map((i) => (
            <li key={`${i.productId}:${i.variantId ?? ""}`} className="flex justify-between gap-3">
              <span className="min-w-0">
                {i.quantity} × {i.name}
                {i.variantLabel && (
                  <span className="text-zinc-500">
                    {" "}— {i.optionLabel ? `${i.optionLabel}: ` : ""}
                    {i.variantLabel}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums">{formatPrice(i.unitPrice * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <OrderTotals subtotal={subtotal} deliveryFee={deliveryFee} />
      </section>

      <div aria-live="assertive">
        {state.error && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-full bg-brand-primary text-base font-semibold text-brand-on-primary disabled:opacity-60"
      >
        {pending ? t.checkout.placing : t.checkout.placeOrder}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-zinc-800">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        hint && <p className="text-xs text-zinc-500">{hint}</p>
      )}
    </div>
  );
}
