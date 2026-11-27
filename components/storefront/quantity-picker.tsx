"use client";

import { t } from "@/lib/i18n";

/** − 1 + control. Stays between 1 and max. */
export function QuantityPicker({
  value,
  max,
  onChange,
  size = "md",
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  size?: "sm" | "md";
}) {
  const btn =
    size === "sm"
      ? "h-8 w-8 text-base"
      : "h-11 w-11 text-lg";
  return (
    <div className="inline-flex items-center rounded-full border border-zinc-300 bg-white">
      <button
        type="button"
        className={`${btn} rounded-full font-semibold text-zinc-700 disabled:text-zinc-300`}
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        aria-label={t.product.decrease}
      >
        −
      </button>
      <span className="min-w-8 text-center font-medium tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={`${btn} rounded-full font-semibold text-zinc-700 disabled:text-zinc-300`}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={t.product.increase}
      >
        +
      </button>
    </div>
  );
}
