// Module-local types for src/inbox. Nothing here is shared with other modules.
// The only thing that leaves this module is an InboxEvent, handed to the injected `emit`.

export const EMAIL_KINDS = [
  "welcome",
  "receipt",
  "login_code",
  "trial_ending",
  "cancellation",
  "unclassified",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export type InboxEventType = `email.${EmailKind}`;

/** A normalized `message.received` webhook. Built from untrusted input. */
export interface InboundEmail {
  messageId: string;
  threadId: string | null;
  inboxId: string | null;
  fromAddress: string | null;
  /** Registrable domain of the sender, e.g. "notion.so" for "mail.notion.so". */
  senderDomain: string | null;
  /** Sanitized and truncated. Untrusted text. */
  subject: string;
  /** First characters of the body. Used for classification only. Never emitted. */
  textPreview: string;
  receivedAt: string;
  /** True when AgentMail dropped text and html because the payload exceeded 1 MB. */
  bodyOmitted: boolean;
}

/**
 * Metadata about an email. It carries references (message_id, thread_id), never the body.
 * Downstream modules fetch the body by id only if they need it, so untrusted text and
 * credentials stay out of events, logs and the database.
 */
export interface InboxEventPayload {
  kind: EmailKind;
  /** Which rule matched, e.g. "subject:trial_ending.1". Makes every label auditable. */
  classified_by: string;
  message_id: string;
  thread_id: string | null;
  inbox_id: string | null;
  sender_address: string | null;
  sender_domain: string | null;
  /** Untrusted. Truncated, control characters stripped, digit runs redacted for login codes. */
  subject: string;
  received_at: string;
  body_omitted: boolean;
}

export interface InboxEvent {
  type: InboxEventType;
  /** Stable per email, so a retried webhook cannot create a second event. */
  dedupe_key: string;
  payload: InboxEventPayload;
}

export interface EmitResult {
  /** True when an event with the same dedupe_key was already recorded. */
  duplicate: boolean;
}

export type EmitEvent = (event: InboxEvent) => Promise<EmitResult>;

export interface InboxLogEntry {
  level: "info" | "warn" | "error";
  msg: string;
  [field: string]: unknown;
}
