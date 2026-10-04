// AgentMail inbox. Classifies each inbound email and emits an InboxEmail to listeners.
import { AgentMailClient, serialization, type AgentMail } from 'agentmail';
import { Webhook } from 'svix';
import * as db from '../db/index.js';
import type { InboxEmail } from '../types.js';
import { classify, extractLoginCode, extractMagicLink, parseSender } from './classify.js';

export type InboxListener = (email: InboxEmail) => Promise<void> | void;

const listeners: InboxListener[] = [];
const seen = new Set<string>(); // webhook retries and socket reconnects can redeliver

export function onInboxEmail(listener: InboxListener): void {
  listeners.push(listener);
}

let client: AgentMailClient | null = null;
function agentmail(): AgentMailClient {
  if (!client) {
    if (!process.env.AGENTMAIL_API_KEY) throw new Error('AGENTMAIL_API_KEY is not set.');
    client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });
  }
  return client;
}

/** The StopLoss address. Creates the inbox on first run; idempotent via clientId. */
export async function ensureInbox(): Promise<string> {
  if (process.env.AGENTMAIL_INBOX_ID) return process.env.AGENTMAIL_INBOX_ID;
  const inbox = await agentmail().inboxes.create({
    username: process.env.AGENTMAIL_USERNAME || undefined,
    displayName: 'StopLoss',
    clientId: 'stoploss-inbox',
  });
  return inbox.inboxId;
}

/** Turns one received message into an InboxEmail, records it, and notifies listeners. */
export async function handleMessage(msg: AgentMail.Message): Promise<InboxEmail | null> {
  if (seen.has(msg.messageId)) return null;
  seen.add(msg.messageId);

  const subject = msg.subject ?? '';
  const body = msg.extractedText ?? msg.text ?? stripHtml(msg.html ?? '');
  const sender = parseSender(msg.from);
  const kind = classify(subject, body);

  let positionId: string | null = null;
  const recent = kind === 'welcome' ? await db.recentPosition(sender.domain, msg.inboxId) : null;
  if (recent && ['closed', 'failed', 'kept'].includes(recent.status)) {
    // A second "welcome" for a service we already handled is not a new trial.
    positionId = recent.id;
  } else if (kind === 'welcome') {
    const { position, created } = await db.openPosition({
      service_name: sender.name,
      service_domain: sender.domain,
      signup_email: msg.inboxId,
    });
    positionId = position.id;
    if (!created && (await alreadyRecorded(position.id, msg.messageId))) return null;
  } else {
    positionId = (await db.findActivePositionByDomain(sender.domain))?.id ?? null;
  }

  const email: InboxEmail = {
    message_id: msg.messageId,
    inbox_id: msg.inboxId,
    kind,
    from: msg.from,
    subject,
    service_name: sender.name,
    service_domain: sender.domain,
    received_at: new Date(msg.timestamp),
    login_code: kind === 'login_code' ? extractLoginCode(subject, body) : null,
    magic_link: kind === 'login_code' ? extractMagicLink(body, sender.domain) : null,
    position_id: positionId,
  };

  if (positionId) {
    // Never store the code or link. Only that one arrived.
    await db.addEvent(positionId, 'email_received', {
      message_id: msg.messageId,
      kind,
      from: msg.from,
      subject: kind === 'login_code' ? '(login code email)' : subject,
    });
  }

  console.log(`[inbox] ${kind} from ${sender.domain}${positionId ? ` -> position ${positionId}` : ''}`);
  for (const listener of listeners) {
    try {
      await listener(email);
    } catch (err) {
      console.error('[inbox] listener failed', err);
    }
  }
  return email;
}

/** Full message body, for the terms module to read as data. */
export async function getMessageText(inboxId: string, messageId: string): Promise<string> {
  const msg = await agentmail().inboxes.messages.get(inboxId, messageId);
  return msg.text ?? stripHtml(msg.html ?? '');
}

/** Sends a plain notification from the StopLoss address (for example, an approval prompt). */
export async function sendEmail(inboxId: string, to: string, subject: string, text: string): Promise<void> {
  await agentmail().inboxes.messages.send(inboxId, { to, subject, text });
}

// ---------- transport 1: WebSocket (local dev, no public URL needed) ----------

export async function listen(inboxId: string): Promise<() => void> {
  const socket = await agentmail().websockets.connect();
  socket.on('message', (event) => {
    if (event.type === 'event' && 'message' in event && isReceived(event.eventType)) {
      void handleMessage(event.message).catch((err) => console.error('[inbox] handle failed', err));
    }
  });
  socket.on('error', (err) => console.error('[inbox] socket error', err));
  await socket.waitForOpen();
  socket.sendSubscribe({ type: 'subscribe', inboxIds: [inboxId], eventTypes: ['message.received'] });
  console.log(`[inbox] listening on ${inboxId} via WebSocket`);
  return () => socket.close();
}

// ---------- safety net: poll, in case a socket or webhook delivery is missed ----------

/** Every `everyMs`, fetches received messages newer than `since` and handles any not yet seen. */
export function poll(inboxId: string, since: Date, everyMs = 20_000): () => void {
  const tick = async () => {
    const { messages } = await agentmail().inboxes.messages.list(inboxId, { limit: 20 });
    const fresh = messages
      .filter((m) => !m.labels.includes('sent') && new Date(m.timestamp) >= since && !seen.has(m.messageId))
      .reverse(); // oldest first
    for (const item of fresh) {
      await handleMessage(await agentmail().inboxes.messages.get(inboxId, item.messageId));
    }
  };
  const timer = setInterval(() => void tick().catch((err) => console.error('[inbox] poll failed', err)), everyMs);
  return () => clearInterval(timer);
}

// ---------- transport 2: signed webhook (deployed) ----------

/** Verifies an AgentMail (Svix) webhook and handles it. Returns an HTTP status code. */
export async function handleWebhook(rawBody: string, headers: Record<string, string>): Promise<number> {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) return 500;
  let payload: unknown;
  try {
    payload = new Webhook(secret).verify(rawBody, headers);
  } catch {
    return 400;
  }
  const raw = payload as { event_type?: string };
  if (!isReceived(raw.event_type)) return 204;
  const parsed = serialization.events.MessageReceivedEvent.parse(payload, {
    unrecognizedObjectKeys: 'strip',
    allowUnrecognizedEnumValues: true,
  });
  if (!parsed.ok) {
    console.error('[inbox] could not parse webhook', parsed.errors);
    return 400;
  }
  // Acknowledge fast; process in the background so Svix does not time out and retry.
  void handleMessage(parsed.value.message).catch((err) => console.error('[inbox] handle failed', err));
  return 204;
}

/** Registers the webhook for the deployed URL. Idempotent via clientId. Returns the signing secret. */
export async function registerWebhook(url: string, inboxId: string): Promise<string | undefined> {
  const hook = await agentmail().webhooks.create({
    url,
    eventTypes: ['message.received'],
    inboxIds: [inboxId],
    clientId: 'stoploss-webhook',
  });
  return hook.secret;
}

// ---------- helpers ----------

function isReceived(eventType: unknown): boolean {
  return eventType === 'message.received';
}

async function alreadyRecorded(positionId: string, messageId: string): Promise<boolean> {
  return (await db.listEvents(positionId)).some((e) => e.payload.message_id === messageId);
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
