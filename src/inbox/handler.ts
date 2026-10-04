import { classifyEmail } from "./classify.js";
import { eventTypeOf, MalformedPayloadError, parseMessageReceived } from "./parse.js";
import { InvalidSignatureError, type VerifyWebhook } from "./verify.js";
import type {
  EmitEvent,
  InboxEvent,
  InboxEventPayload,
  InboxLogEntry,
} from "./types.js";

// Framework-agnostic: takes a Web Request, returns a Web Response. Works in Node 22 (via a tiny
// adapter), Next.js route handlers, Hono, Fly.io, etc. No framework is chosen here on purpose.
//
// Status codes (AgentMail/Svix retries on non-2xx):
//   405 not POST            400 bad or missing signature   413 body too large
//   500 emit failed (so AgentMail retries; the dedupe key makes the retry safe)
//   200 everything else, including events we ignore and signed-but-malformed payloads
//       (retrying a payload we can't parse would never help, so we log loudly and stop)

export const MAX_BODY_BYTES = 2 * 1024 * 1024;

const WATCHED_EVENT = "message.received";

export interface InboxHandlerDeps {
  verify: VerifyWebhook;
  emit: EmitEvent;
  log?: (entry: InboxLogEntry) => void;
}

/** Login codes are credentials. Redact digit runs so they never reach events, logs or the DB. */
function redactForKind(kind: string, subject: string): string {
  return kind === "login_code" ? subject.replace(/\d{3,}/g, "[redacted]") : subject;
}

export function createInboxHandler(deps: InboxHandlerDeps) {
  const log = deps.log ?? (() => {});

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
    }

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) {
      return new Response("payload too large", { status: 413 });
    }

    // The signature covers the exact bytes, so read raw text. Never re-serialize parsed JSON.
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return new Response("payload too large", { status: 413 });
    }

    try {
      deps.verify(rawBody, request.headers);
    } catch (error) {
      if (error instanceof InvalidSignatureError) {
        log({ level: "warn", msg: "inbox.webhook.rejected", reason: error.message });
        return new Response("invalid signature", { status: 400 });
      }
      throw error;
    }

    // Signature is valid, so this is AgentMail's body. Parse only now, never before verifying.
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      log({ level: "error", msg: "inbox.webhook.malformed", reason: "body is not JSON" });
      return Response.json({ ok: true, dropped: "malformed" });
    }

    const eventType = eventTypeOf(payload);
    if (eventType !== WATCHED_EVENT) {
      return Response.json({ ok: true, ignored: eventType ?? "unknown" });
    }

    let event: InboxEvent;
    try {
      const email = parseMessageReceived(payload);
      const { kind, classifiedBy } = classifyEmail(email.subject, email.textPreview);
      const eventPayload: InboxEventPayload = {
        kind,
        classified_by: classifiedBy,
        message_id: email.messageId,
        thread_id: email.threadId,
        inbox_id: email.inboxId,
        sender_address: email.fromAddress,
        recipient_address: email.recipientAddress,
        sender_domain: email.senderDomain,
        subject: redactForKind(kind, email.subject),
        received_at: email.receivedAt,
        body_omitted: email.bodyOmitted,
      };
      event = {
        type: `email.${kind}`,
        dedupe_key: `agentmail:${email.messageId}`,
        payload: eventPayload,
      };
    } catch (error) {
      if (error instanceof MalformedPayloadError) {
        log({ level: "error", msg: "inbox.webhook.malformed", reason: error.message });
        return Response.json({ ok: true, dropped: "malformed" });
      }
      throw error;
    }

    try {
      const result = await deps.emit(event);
      log({
        level: "info",
        msg: result.duplicate ? "inbox.event.duplicate" : "inbox.event.emitted",
        type: event.type,
        classified_by: event.payload.classified_by,
        message_id: event.payload.message_id,
      });
      return Response.json({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      log({
        level: "error",
        msg: "inbox.emit.failed",
        message_id: event.payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response("emit failed", { status: 500 });
    }
  };
}
