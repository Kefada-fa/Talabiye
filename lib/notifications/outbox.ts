import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "./email";
import { loadOrderDetails } from "./order-details";
import { sendPush } from "./push";
import { buildOrderCreatedEmail } from "./templates/order-created-email";
import { MAX_ATTEMPTS, type OrderDetails, type OutboxRow } from "./types";

/**
 * NOTIFICATION SENDER — sends what's waiting in public.notification_outbox.
 *
 * The database puts a row in the outbox for every new order (trigger), so
 * no order is ever missed. This function:
 *   1. claims up to `limit` due rows (claim_notifications marks them
 *      "sending" and counts the attempt — two servers never take the same row),
 *   2. sends each one (email now, push later),
 *   3. marks it "sent", or puts it back to "pending" to retry, or "failed"
 *      after 3 attempts (with the error saved in last_error).
 *
 * Called right after checkout (in the background, via after()). Rows that
 * failed earlier are retried the next time it runs. Later we can also run
 * it on a schedule (cron) so retries don't wait for the next order.
 *
 * Needs SUPABASE_SECRET_KEY (server-only). Without it, it logs a warning
 * and does nothing — the rows simply wait in the outbox.
 */
export async function processOutbox({ limit = 20 }: { limit?: number } = {}): Promise<{
  sent: number;
  retrying: number;
  failed: number;
}> {
  const result = { sent: 0, retrying: 0, failed: 0 };

  const admin = createAdminClient();
  if (!admin) {
    console.warn(
      "[notifications] SUPABASE_SECRET_KEY is not set — new-order notifications are waiting in the outbox and will be sent once it is configured.",
    );
    return result;
  }

  const { data, error } = await admin.rpc("claim_notifications", { p_limit: limit });
  if (error) {
    console.error("[notifications] could not claim outbox rows:", error.message);
    return result;
  }

  const jobs = (data ?? []) as OutboxRow[];
  const orderCache = new Map<string, Promise<OrderDetails>>();

  for (const job of jobs) {
    try {
      if (!orderCache.has(job.order_id)) {
        orderCache.set(job.order_id, loadOrderDetails(admin, job.order_id));
      }
      const order = await orderCache.get(job.order_id)!;

      if (job.channel === "email") {
        const email = buildOrderCreatedEmail(order);
        await sendEmail({ to: job.recipient, ...email, idempotencyKey: `outbox-${job.id}` });
      } else if (job.channel === "push") {
        await sendPush(job, order);
      } else {
        throw new Error(`Unknown channel: ${String(job.channel)}`);
      }

      await admin
        .from("notification_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", job.id);
      result.sent++;
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
      const giveUp = job.attempts >= MAX_ATTEMPTS;
      await admin
        .from("notification_outbox")
        .update({ status: giveUp ? "failed" : "pending", last_error: message })
        .eq("id", job.id);
      if (giveUp) result.failed++;
      else result.retrying++;
      console.error(
        `[notifications] ${job.channel} to ${job.recipient} failed (attempt ${job.attempts}/${MAX_ATTEMPTS}${giveUp ? ", giving up" : ", will retry"}): ${message}`,
      );
    }
  }

  if (jobs.length > 0) {
    console.info(
      `[notifications] processed ${jobs.length}: ${result.sent} sent, ${result.retrying} will retry, ${result.failed} failed`,
    );
  }
  return result;
}
