import { AgentMailClient } from "agentmail";

let client: AgentMailClient | null = null;
let inbox: { inboxId: string; email: string } | null = null;

export function agentmail(): AgentMailClient {
  if (!client) {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    if (!apiKey) throw new Error("AGENTMAIL_API_KEY is not set");
    client = new AgentMailClient({ apiKey });
  }
  return client;
}

// The StopLoss inbox. Created once: clientId makes inboxes.create idempotent, so every call returns the same inbox.
export async function ensureInbox(): Promise<{ inboxId: string; email: string }> {
  if (inbox) return inbox;
  const created = await agentmail().inboxes.create({
    username: process.env.STOPLOSS_INBOX_USERNAME || undefined,
    displayName: "StopLoss",
    clientId: process.env.STOPLOSS_INBOX_CLIENT_ID || "stoploss-main-inbox",
  });
  inbox = { inboxId: created.inboxId, email: created.email };
  return inbox;
}

export async function stopLossAddress(): Promise<string> {
  return (await ensureInbox()).email;
}

export type InboxListItem = {
  message_id: string;
  thread_id: string;
  from: string;
  subject: string;
  preview: string;
  received_at: string;
};

export async function listInbox(limit = 50): Promise<InboxListItem[]> {
  const { inboxId } = await ensureInbox();
  const res = await agentmail().inboxes.messages.list(inboxId, { limit });
  return res.messages.map((m) => ({
    message_id: m.messageId,
    thread_id: m.threadId,
    from: m.from,
    subject: m.subject ?? "(no subject)",
    preview: m.preview ?? "",
    received_at: new Date(m.timestamp).toISOString(),
  }));
}

export type FullMessage = InboxListItem & { to: string[]; text: string; html: string | null };

// Many service emails are HTML-only (no text part), so readable text comes from the HTML when it must.
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export async function getMessage(messageId: string): Promise<FullMessage> {
  const { inboxId } = await ensureInbox();
  const m = await agentmail().inboxes.messages.get(inboxId, messageId);
  return {
    message_id: m.messageId,
    thread_id: m.threadId,
    from: m.from,
    to: m.to,
    subject: m.subject ?? "(no subject)",
    preview: m.preview ?? "",
    received_at: new Date(m.timestamp).toISOString(),
    text: m.extractedText || m.text || (m.html ? htmlToText(m.html) : ""),
    html: m.html ?? null,
  };
}
