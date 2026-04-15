/**
 * Server-side Web Push sender.
 * Call sendPushToPage() after new signals are detected to notify all subscribers.
 */
import webpush from "web-push";
import { getPushSubscriptionsForPage, deletePushSubscription } from "@/lib/db";

const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY!;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY!;
const vapidSubject    = process.env.VAPID_SUBJECT ?? "mailto:admin@coinpree.com";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
}

/**
 * Send a push notification to every subscriber that has `page` in their pages list.
 * Expired/invalid subscriptions are automatically removed from the DB.
 */
export async function sendPushToPage(page: string, payload: PushPayload) {
  if (!vapidPublicKey || !vapidPrivateKey) return;

  const all = getPushSubscriptionsForPage(page);
  if (all.length === 0) return;

  const targets = all.filter(row => {
    try {
      const pages: string[] = JSON.parse(row.pages);
      return pages.includes(page);
    } catch {
      return false;
    }
  });

  if (targets.length === 0) return;

  const payloadStr = JSON.stringify(payload);

  await Promise.allSettled(
    targets.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payloadStr,
          { TTL: 60 * 60 } // 1 hour TTL
        );
      } catch (err: unknown) {
        // 404 / 410 = subscription expired — clean it up
        if (
          err &&
          typeof err === "object" &&
          "statusCode" in err &&
          (err.statusCode === 404 || err.statusCode === 410)
        ) {
          deletePushSubscription(row.endpoint);
        } else {
          console.warn("[Push] Failed to send to", row.endpoint, err);
        }
      }
    })
  );
}
