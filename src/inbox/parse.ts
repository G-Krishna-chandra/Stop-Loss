import { domainOfAddress, extractAddress } from "./domain.js";
import type { InboundEmail } from "./types.js";

// Turns a signature-verified webhook payload into an InboundEmail.
// "Verified" means it came from AgentMail. It does NOT mean the contents are trustworthy:
// the subject and body were written by whoever sent the email. Everything is treated as untrusted.
//
// AgentMail's docs show the sender as `from_` in some places and `from` in others, so both are
// accepted. Verify against one real delivered payload (scripts/inbox-dev-server.ts logs it).

export class MalformedPayloadError extends Error {}

export const MAX_SUBJECT_CHARS = 300;
export const MAX_PREVIEW_CHARS = 600;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Control characters, zero-width and bidi-override characters, and line/paragraph separators.
// Written as escapes (not literals) so the source file stays plain ASCII.
const UNSAFE_CHARS = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e]",
  "g",
);

/** Strips unsafe characters and collapses whitespace, then truncates. */
export function sanitizeText(raw: string, max: number): string {
  const cleaned = raw.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}\u2026` : cleaned;
}

export function eventTypeOf(payload: unknown): string | null {
  if (!isObject(payload)) return null;
  return str(payload["event_type"]) ?? str(payload["type"]);
}

/** `to` is a list of addresses in AgentMail's message object. Accepts a bare string too. */
function firstRecipient(value: unknown): string | null {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const address = extractAddress(candidate);
    if (address) return address;
  }
  return null;
}

export function parseMessageReceived(payload: unknown): InboundEmail {
  if (!isObject(payload)) throw new MalformedPayloadError("payload is not an object");
  const message = payload["message"];
  if (!isObject(message)) throw new MalformedPayloadError("payload.message missing");

  const messageId = str(message["message_id"]);
  if (!messageId) throw new MalformedPayloadError("message.message_id missing");

  const rawFrom = str(message["from_"]) ?? str(message["from"]);
  const fromAddress = rawFrom ? extractAddress(rawFrom) : null;

  const rawSubject = str(message["subject"]) ?? "";
  const rawText = str(message["text"]) ?? str(message["preview"]) ?? "";
  const hasBody = str(message["text"]) !== null || str(message["html"]) !== null;

  const receivedAt =
    str(message["timestamp"]) ?? str(message["created_at"]) ?? new Date().toISOString();

  return {
    messageId,
    threadId: str(message["thread_id"]),
    inboxId: str(message["inbox_id"]),
    fromAddress,
    recipientAddress: firstRecipient(message["to"]),
    senderDomain: fromAddress ? domainOfAddress(fromAddress) : null,
    subject: sanitizeText(rawSubject, MAX_SUBJECT_CHARS),
    textPreview: sanitizeText(rawText, MAX_PREVIEW_CHARS),
    receivedAt,
    // AgentMail drops text and html above 1 MB. No body at all is the signal.
    bodyOmitted: !hasBody && rawText === "",
  };
}
