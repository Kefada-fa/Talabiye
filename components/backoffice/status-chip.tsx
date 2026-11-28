import { t } from "@/lib/i18n";

export type OrderStatus = "unconfirmed" | "pending" | "paid" | "cancelled" | "refused";

// Colors come from the back-office design tokens (app/globals.css).
const STYLES: Record<OrderStatus, string> = {
  unconfirmed: "bg-status-unconfirmed-bg text-status-unconfirmed-fg",
  pending: "bg-status-pending-bg text-status-pending-fg",
  paid: "bg-status-paid-bg text-status-paid-fg",
  cancelled: "bg-status-cancelled-bg text-status-cancelled-fg",
  refused: "bg-status-refused-bg text-status-refused-fg",
};

/** The one reusable order-status chip for every back-office screen. */
export function StatusChip({ status, className = "" }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[status]} ${className}`}
    >
      {t.backoffice.status[status]}
    </span>
  );
}
