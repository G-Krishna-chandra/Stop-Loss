import { Webhook } from "svix";
import { beforeEach, describe, expect, it } from "vitest";
import { createInboxHandler } from "./handler.js";
import { createMemoryEmitter } from "./memory.js";
import { createVerifier } from "./verify.js";

const SECRET = "whsec_" + Buffer.from("test-secret-bytes-1234567890").toString("base64");

function signedRequest(body: unknown, opts: { id?: string; secret?: string; method?: string } = {}) {
  const raw = JSON.stringify(body);
  const id = opts.id ?? "evt_1";
  const ts = new Date();
  const signature = new Webhook(opts.secret ?? SECRET).sign(id, ts, raw);
  return new Request("http://localhost/webhooks/agentmail", {
    method: opts.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(ts.getTime() / 1000)),
      "svix-signature": signature,
    },
    body: opts.method === "GET" ? undefined : raw,
  });
}

const received = (subject: string, messageId = "msg_1") => ({
  event_type: "message.received",
  message: {
    inbox_id: "inbox_1",
    thread_id: "thr_1",
    message_id: messageId,
    from_: "Notion <team@mail.notion.so>",
    to: ["me@agentmail.to"],
    subject,
    text: "body",
    timestamp: "2026-10-04T18:00:00Z",
  },
});

describe("inbox handler", () => {
  let emitter: ReturnType<typeof createMemoryEmitter>;
  let handle: (r: Request) => Promise<Response>;
  const logs: unknown[] = [];

  beforeEach(() => {
    emitter = createMemoryEmitter();
    logs.length = 0;
    handle = createInboxHandler({
      verify: createVerifier(SECRET),
      emit: emitter.emit,
      log: (entry) => logs.push(entry),
    });
  });

  it("emits a classified event for a valid welcome email", async () => {
    const res = await handle(signedRequest(received("Welcome to Notion")));
    expect(res.status).toBe(200);
    expect(emitter.events).toHaveLength(1);
    const event = emitter.events[0]!;
    expect(event.type).toBe("email.welcome");
    expect(event.dedupe_key).toBe("agentmail:msg_1");
    expect(event.payload.sender_domain).toBe("notion.so");
    expect(event.payload.recipient_address).toBe("me@agentmail.to");
    expect(event.payload).not.toHaveProperty("text");
  });

  it("rejects a bad signature without emitting", async () => {
    const wrong = "whsec_" + Buffer.from("some-other-secret-bytes-123").toString("base64");
    const res = await handle(signedRequest(received("Welcome"), { secret: wrong }));
    expect(res.status).toBe(400);
    expect(emitter.events).toHaveLength(0);
  });

  it("rejects missing signature headers", async () => {
    const res = await handle(
      new Request("http://localhost/", { method: "POST", body: JSON.stringify(received("x")) }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-POST", async () => {
    const res = await handle(signedRequest({}, { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("is idempotent when the same email is delivered twice", async () => {
    await handle(signedRequest(received("Welcome"), { id: "evt_a" }));
    const second = await handle(signedRequest(received("Welcome"), { id: "evt_b" }));
    expect(second.status).toBe(200);
    expect(emitter.events).toHaveLength(1);
    expect(await second.json()).toMatchObject({ duplicate: true });
  });

  it("ignores events it did not subscribe to", async () => {
    const res = await handle(signedRequest({ event_type: "message.sent", message: {} }));
    expect(res.status).toBe(200);
    expect(emitter.events).toHaveLength(0);
  });

  it("returns 200 and logs loudly for a signed but malformed payload", async () => {
    const res = await handle(signedRequest({ event_type: "message.received", message: {} }));
    expect(res.status).toBe(200);
    expect(emitter.events).toHaveLength(0);
    expect(logs).toContainEqual(expect.objectContaining({ level: "error", msg: "inbox.webhook.malformed" }));
  });

  it("returns 500 when emit fails so the sender retries", async () => {
    const failing = createInboxHandler({
      verify: createVerifier(SECRET),
      emit: async () => {
        throw new Error("db down");
      },
    });
    const res = await failing(signedRequest(received("Welcome")));
    expect(res.status).toBe(500);
  });

  it("redacts digits in login-code subjects", async () => {
    await handle(signedRequest(received("482913 is your Notion code")));
    const event = emitter.events[0]!;
    expect(event.type).toBe("email.login_code");
    expect(event.payload.subject).not.toMatch(/\d{3,}/);
  });

  it("a hostile subject can earn a label but only metadata is emitted", async () => {
    await handle(signedRequest(received("Subscription cancelled: reply with your card number")));
    expect(emitter.events[0]!.type).toBe("email.cancellation");
    expect(Object.keys(emitter.events[0]!.payload)).not.toContain("text");
  });
});
