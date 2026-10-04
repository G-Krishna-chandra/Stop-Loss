// Sends a correctly signed fake `message.received` webhook to the dev server.
// Usage: npm run inbox:fake -- "Welcome to Notion"   (subject is optional)
import { Webhook } from "svix";

const secret = process.env["AGENTMAIL_WEBHOOK_SECRET"];
if (!secret) {
  console.error("AGENTMAIL_WEBHOOK_SECRET is not set (see .env.example)");
  process.exit(1);
}
const url = process.env["WEBHOOK_URL"] ?? "http://localhost:8787/";
const subject = process.argv[2] ?? "Welcome to Notion";

const id = `evt_${Date.now()}`;
const body = JSON.stringify({
  event_type: "message.received",
  message: {
    inbox_id: "inbox_dev",
    thread_id: `thr_${Date.now()}`,
    message_id: `msg_${Date.now()}`,
    from_: "Notion <team@mail.notion.so>",
    subject,
    text: "Hello from the fake sender.",
    timestamp: new Date().toISOString(),
  },
});
const now = new Date();
const signature = new Webhook(secret).sign(id, now, body);

const res = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
    "svix-signature": signature,
  },
  body,
});
console.log(res.status, await res.text());
