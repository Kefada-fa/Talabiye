import "server-only";
import type { OrderDetails, OutboxRow } from "./types";

/**
 * PUSH NOTIFICATIONS — NOT BUILT YET (stub).
 *
 * How it will work (no database redesign needed):
 *   1. The phone app / PWA asks permission, gets a push token, and saves
 *      it in public.device_push_tokens (user_id, shop_id, platform, token).
 *   2. The shop owner turns on shop_notification_settings.push_enabled.
 *   3. For each new order, the database trigger already queues one
 *      'push' row per device in notification_outbox
 *      (recipient = device_push_tokens.id).
 *   4. This function will look up the token by that id and send:
 *        - platform 'web'           → Web Push (VAPID keys, e.g. `web-push`)
 *        - platform 'ios'/'android' → Firebase Cloud Messaging / APNs
 *          (or Expo push if the app is built with Expo)
 *      If the provider says the token is no longer valid, delete that
 *      device_push_tokens row.
 *
 * Until then push_enabled stays false, so no push rows are created. If one
 * is created anyway, it fails clearly and is retried up to 3 times.
 */
export async function sendPush(job: OutboxRow, order: OrderDetails): Promise<void> {
  void order;
  throw new Error(
    `Push notifications are not implemented yet (outbox row ${job.id}). See lib/notifications/push.ts.`,
  );
}
