// Local stand-in for the AgentMail webhook: listens on AgentMail WebSockets and forwards each new message to the
// running app's webhook route, and runs the stop check every minute. Needs ALLOW_UNSIGNED_WEBHOOKS=1 and CRON_SECRET
// in .env.local. Run alongside `npm run dev`:
//   npm run inbox:listen
import { AgentMailClient } from "agentmail";

const base = process.env.STOPLOSS_URL || "http://localhost:3000";
const client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });
const inbox = await client.inboxes.create({
  username: process.env.STOPLOSS_INBOX_USERNAME || undefined,
  displayName: "StopLoss",
  clientId: process.env.STOPLOSS_INBOX_CLIENT_ID || "stoploss-main-inbox",
});

async function forward(messageId, eventId = null) {
  const res = await fetch(`${base}/api/webhooks/agentmail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "event",
      event_type: "message.received",
      event_id: eventId,
      message: { inbox_id: inbox.inboxId, message_id: messageId },
    }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`${new Date().toLocaleTimeString()}  ${res.status}  ${messageId}  ${JSON.stringify(body)}`);
}

// Catch up on recent mail first. The app records each message once, so repeats are ignored.
const recent = await client.inboxes.messages.list(inbox.inboxId, { limit: 20 });
for (const m of [...recent.messages].reverse()) await forward(m.messageId);

const socket = await client.websockets.connect();
socket.on("message", (event) => {
  if (event.type === "event" && event.eventType === "message.received") {
    forward(event.message.messageId, event.eventId).catch((err) => console.error("forward failed:", err.message));
  }
});
socket.on("error", (err) => console.error("websocket error:", err.message));
await socket.waitForOpen();
socket.sendSubscribe({ type: "subscribe", inboxIds: [inbox.inboxId], eventTypes: ["message.received"] });
console.log(`Listening for mail to ${inbox.email}. Forwarding to ${base}/api/webhooks/agentmail`);

// The scheduled stop check, once a minute, in place of a hosted cron.
if (process.env.CRON_SECRET) {
  const check = async () => {
    const res = await fetch(`${base}/api/cron/stops`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (body.stops_pending) console.log(`${new Date().toLocaleTimeString()}  stop check: ${body.stops_pending} stop(s) now waiting for you`);
  };
  await check();
  setInterval(check, 60_000);
  console.log("Checking for due stops every minute.");
}
