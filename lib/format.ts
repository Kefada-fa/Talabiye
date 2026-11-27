import { t } from "@/lib/i18n";

const usd = new Intl.NumberFormat(t.locale, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 12 → "$12.00". All prices are in USD. */
export function formatPrice(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return usd.format(Number.isFinite(value) ? value : 0);
}

/** Avoids floating-point drift when adding money: works in cents. */
export function sumMoney(values: number[]): number {
  return values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;
}
