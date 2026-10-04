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
    text: m.extractedText ?? m.text ?? "",
    html: m.html ?? null,
  };
}
