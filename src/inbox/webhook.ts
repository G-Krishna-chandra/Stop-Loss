import { Webhook } from "svix";

export class WebhookError extends Error {}

export type ReceivedRef = { inboxId: string; messageId: string; eventId: string | null };

// Verifies the Svix signature on the raw body, then pulls out which message arrived.
// AGENTMAIL_WEBHOOK_SECRET is required. ALLOW_UNSIGNED_WEBHOOKS=1 skips the check in local development only.
export function verifyReceived(rawBody: string, headers: Headers): ReceivedRef | null {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  let payload: unknown;
  if (secret) {
    try {
      // svix 2.x verify() throws on a bad signature and returns nothing on success, so parse the body ourselves.
      new Webhook(secret).verify(rawBody, {
        "svix-id": headers.get("svix-id") ?? "",
        "svix-timestamp": headers.get("svix-timestamp") ?? "",
        "svix-signature": headers.get("svix-signature") ?? "",
      });
    } catch {
      throw new WebhookError("Invalid webhook signature");
    }
    payload = JSON.parse(rawBody);
  } else if (process.env.NODE_ENV !== "production" && process.env.ALLOW_UNSIGNED_WEBHOOKS === "1") {
    payload = JSON.parse(rawBody);
  } else {
    throw new WebhookError("AGENTMAIL_WEBHOOK_SECRET is not set");
  }

  const p = payload as Record<string, unknown>;
  const eventType = (p.event_type ?? p.eventType) as string | undefined;
  if (eventType !== "message.received") return null;
  const message = (p.message ?? {}) as Record<string, unknown>;
  const inboxId = (message.inbox_id ?? message.inboxId) as string | undefined;
  const messageId = (message.message_id ?? message.messageId) as string | undefined;
  if (!inboxId || !messageId) throw new WebhookError("message.received without inbox_id or message_id");
  return { inboxId, messageId, eventId: ((p.event_id ?? p.eventId) as string | undefined) ?? null };
}
