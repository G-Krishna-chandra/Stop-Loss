import { describe, expect, it } from "vitest";
import {
  MalformedPayloadError,
  MAX_SUBJECT_CHARS,
  parseMessageReceived,
  sanitizeText,
} from "./parse.js";

const base = {
  event_type: "message.received",
  message: {
    inbox_id: "inbox_1",
    thread_id: "thr_1",
    message_id: "msg_1",
    from_: "Notion <team@mail.notion.so>",
    subject: "Welcome to Notion",
    text: "Hello",
    timestamp: "2026-10-04T18:00:00Z",
  },
};

describe("parseMessageReceived", () => {
  it("normalizes a payload", () => {
    const email = parseMessageReceived(base);
    expect(email.messageId).toBe("msg_1");
    expect(email.fromAddress).toBe("team@mail.notion.so");
    expect(email.senderDomain).toBe("notion.so");
    expect(email.bodyOmitted).toBe(false);
  });

  it("accepts `from` as well as `from_`", () => {
    const { from_, ...rest } = base.message;
    const email = parseMessageReceived({ ...base, message: { ...rest, from: from_ } });
    expect(email.senderDomain).toBe("notion.so");
  });

  it("flags an omitted body", () => {
    const { text, ...rest } = base.message;
    expect(parseMessageReceived({ ...base, message: rest }).bodyOmitted).toBe(true);
  });

  it("rejects payloads without a message id", () => {
    const { message_id, ...rest } = base.message;
    expect(() => parseMessageReceived({ ...base, message: rest })).toThrow(MalformedPayloadError);
    expect(() => parseMessageReceived(null)).toThrow(MalformedPayloadError);
    expect(() => parseMessageReceived({})).toThrow(MalformedPayloadError);
  });

  it("sanitizes hostile subjects", () => {
    const email = parseMessageReceived({
      ...base,
      message: { ...base.message, subject: `Hi\u0000‮\n${"x".repeat(1000)}` },
    });
    expect(email.subject.length).toBeLessThanOrEqual(MAX_SUBJECT_CHARS);
    expect(email.subject).not.toMatch(/[\u0000‮\n]/);
  });
});

describe("sanitizeText", () => {
  it("collapses whitespace", () => {
    expect(sanitizeText("a \n\t b", 50)).toBe("a b");
  });
});
