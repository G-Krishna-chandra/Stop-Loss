import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db, IngestEvent } from "./contract.js";
import {
  ApprovalAlreadyResolvedError,
  ApprovalNotFoundError,
  InvalidTransitionError,
  PositionNotEditableError,
  PositionNotFoundError,
  TransitionContextError,
} from "./errors.js";
import { createMemoryDb } from "./memory.js";
import { createPostgresDb, migrate, type SqlRunner } from "./postgres.js";

// One suite, run against every backend. If the in-memory and Postgres versions ever disagree,
// a test here fails. "postgres" is real Postgres (PGlite, in-process), not a mock, so the actual
// SQL, unique indexes and compare-and-set updates are exercised.

interface Harness {
  db: Db;
  close: () => Promise<void>;
}

function deterministic() {
  let tick = 0;
  let id = 0;
  return {
    now: () => new Date(Date.UTC(2026, 9, 4, 18, 0, tick++)),
    newId: () => `id_${++id}`,
  };
}

// Booting PGlite takes about a second, so one instance serves the whole file and every test
// starts from empty tables.
let shared: { pg: PGlite; run: SqlRunner } | undefined;

async function sharedPostgres() {
  if (!shared) {
    const pg = new PGlite();
    const run: SqlRunner = async (text, params) => (await pg.query(text, params as unknown[])).rows as never;
    await migrate(run);
    await migrate(run); // idempotent
    shared = { pg, run };
  }
  await shared.pg.exec("TRUNCATE events, inbox_events, approval_requests, positions RESTART IDENTITY CASCADE");
  return shared;
}

afterAll(async () => {
  await shared?.pg.close();
});

const backends: Array<[string, () => Promise<Harness>]> = [
  ["memory", async () => ({ db: createMemoryDb(deterministic()), close: async () => {} })],
  [
    "postgres (pglite)",
    async () => {
      const { run } = await sharedPostgres();
      return { db: createPostgresDb(run, deterministic()), close: async () => {} };
    },
  ],
];

const email = (kind: string, id: string, extra: Record<string, unknown> = {}): IngestEvent => ({
  type: `email.${kind}`,
  dedupe_key: `agentmail:${id}`,
  payload: {
    kind,
    message_id: id,
    inbox_id: "inbox_1",
    recipient_address: "me@agentmail.to",
    sender_domain: "notion.so",
    subject: `${kind} email`,
    ...extra,
  },
});

const TERMS = {
  trial_days: 14,
  renewal_price_cents: 1200,
  currency: "USD",
  cancel_policy: "Cancel any time in Settings > Billing.",
  cancel_url: "https://notion.so/settings/billing",
  source_urls: ["https://notion.so/help/cancel"],
};

describe.each(backends)("db contract: %s", (_name, build) => {
  let h: Harness;
  let db: Db;

  beforeEach(async () => {
    h = await build();
    db = h.db;
  });
  afterEach(() => h.close());

  async function open(overrides: Record<string, unknown> = {}, id = "w1") {
    const result = await db.emit(email("welcome", id, overrides));
    expect(result.position_id).not.toBeNull();
    return result.position_id as string;
  }

  /** Walks a position all the way to cancelling. */
  async function toCancelling(position_id: string) {
    await db.transitionPosition(position_id, "stop_pending");
    await db.transitionPosition(position_id, "approved");
    await db.transitionPosition(position_id, "cancelling");
  }

  describe("emit", () => {
    it("opens a position from a welcome email", async () => {
      const result = await db.emit(email("welcome", "w1"));
      expect(result.duplicate).toBe(false);
      const position = await db.getPosition(result.position_id!);
      expect(position).toMatchObject({
        service_name: "Notion",
        service_domain: "notion.so",
        signup_email: "me@agentmail.to",
        status: "open",
        renewal_date: null,
        renewal_price_cents: null,
        evidence_email_id: null,
      });
      const types = (await db.listEvents(position!.id)).map((e) => e.type);
      expect(types).toEqual(["position.opened", "email.welcome"]);
    });

    it("is idempotent: the same dedupe_key changes nothing", async () => {
      const first = await db.emit(email("welcome", "w1"));
      const second = await db.emit(email("welcome", "w1"));
      expect(second).toEqual({ duplicate: true, position_id: first.position_id });
      expect(await db.listPositions()).toHaveLength(1);
      expect(await db.listEvents(first.position_id!)).toHaveLength(2);
    });

    it("survives two identical deliveries racing", async () => {
      const [a, b] = await Promise.all([db.emit(email("welcome", "w1")), db.emit(email("welcome", "w1"))]);
      expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
      expect(await db.listPositions()).toHaveLength(1);
    });

    it("reuses the live position for a second welcome from the same service", async () => {
      const a = await db.emit(email("welcome", "w1"));
      const b = await db.emit(email("welcome", "w2"));
      expect(b.duplicate).toBe(false);
      expect(b.position_id).toBe(a.position_id);
      expect(await db.listPositions()).toHaveLength(1);
    });

    it("opens a new position once the previous one is finished", async () => {
      const first = await open();
      await db.transitionPosition(first, "failed", { reason: "test" });
      const second = await open({}, "w2");
      expect(second).not.toBe(first);
      expect(await db.listPositions()).toHaveLength(2);
    });

    it("keeps different services and different signup addresses apart", async () => {
      const a = await open({ sender_domain: "notion.so" }, "w1");
      const b = await open({ sender_domain: "linear.app" }, "w2");
      const c = await open({ recipient_address: "other@agentmail.to" }, "w3");
      expect(new Set([a, b, c]).size).toBe(3);
    });

    it("attaches later emails to the live position by sender domain", async () => {
      const position_id = await open();
      const ending = await db.emit(email("trial_ending", "t1"));
      expect(ending.position_id).toBe(position_id);
      const types = (await db.listEvents(position_id)).map((e) => e.type);
      expect(types).toEqual(["position.opened", "email.welcome", "email.trial_ending"]);
    });

    it("does not attach an email from an unrelated domain", async () => {
      await open();
      const spoof = await db.emit(email("cancellation", "c1", { sender_domain: "evil.example" }));
      expect(spoof).toEqual({ duplicate: false, position_id: null });
    });

    it("records an email with no sender without opening a position", async () => {
      const result = await db.emit(email("welcome", "w1", { sender_domain: null }));
      expect(result).toEqual({ duplicate: false, position_id: null });
      expect(await db.listPositions()).toHaveLength(0);
    });

    it("falls back to inbox_id when there is no recipient address", async () => {
      const id = await open({ recipient_address: null });
      expect((await db.getPosition(id))!.signup_email).toBe("inbox_1");
    });

    it("stores untrusted text as plain data", async () => {
      const subject = `'); DROP TABLE positions; --`;
      const id = await open({ subject });
      expect(await db.getPosition(id)).not.toBeNull();
      expect((await db.listEvents(id))[1]!.payload["subject"]).toBe(subject);
    });
  });

  describe("transitionPosition", () => {
    it("walks the happy path and writes a timeline", async () => {
      const id = await open();
      await toCancelling(id);
      const closed = await db.transitionPosition(id, "closed", { evidence_email_id: "msg_cancel" });
      expect(closed).toMatchObject({ status: "closed", evidence_email_id: "msg_cancel" });
      const changes = (await db.listEvents(id)).filter((e) => e.type === "status.changed");
      expect(changes.map((e) => [e.payload["from"], e.payload["to"]])).toEqual([
        ["open", "stop_pending"],
        ["stop_pending", "approved"],
        ["approved", "cancelling"],
        ["cancelling", "closed"],
      ]);
    });

    it("rejects a skipped step", async () => {
      const id = await open();
      await expect(db.transitionPosition(id, "approved")).rejects.toBeInstanceOf(InvalidTransitionError);
      await expect(db.transitionPosition(id, "cancelling")).rejects.toBeInstanceOf(InvalidTransitionError);
      expect((await db.getPosition(id))!.status).toBe("open");
    });

    it("lets a human decline", async () => {
      const id = await open();
      await db.transitionPosition(id, "stop_pending");
      expect((await db.transitionPosition(id, "kept")).status).toBe("kept");
    });

    it("refuses to leave a terminal status", async () => {
      const id = await open();
      await db.transitionPosition(id, "failed", { reason: "boom" });
      await expect(db.transitionPosition(id, "stop_pending")).rejects.toBeInstanceOf(InvalidTransitionError);
      await expect(db.transitionPosition(id, "failed", { reason: "again" })).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
    });

    it("requires email proof to close and a reason to fail", async () => {
      const id = await open();
      await toCancelling(id);
      await expect(db.transitionPosition(id, "closed")).rejects.toBeInstanceOf(TransitionContextError);
      await expect(db.transitionPosition(id, "failed")).rejects.toBeInstanceOf(TransitionContextError);
      expect((await db.getPosition(id))!.status).toBe("cancelling");
    });

    it("records the failure reason", async () => {
      const id = await open();
      await db.transitionPosition(id, "failed", { reason: "needs login" });
      const last = (await db.listEvents(id)).at(-1)!;
      expect(last.payload).toMatchObject({ from: "open", to: "failed", reason: "needs login" });
    });

    it("lets exactly one of two racing workers claim the cancel", async () => {
      const id = await open();
      await db.transitionPosition(id, "stop_pending");
      await db.transitionPosition(id, "approved");
      const results = await Promise.allSettled([
        db.transitionPosition(id, "cancelling"),
        db.transitionPosition(id, "cancelling"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(loser.reason).toBeInstanceOf(InvalidTransitionError);
      const claims = (await db.listEvents(id)).filter((e) => e.payload["to"] === "cancelling");
      expect(claims).toHaveLength(1);
    });

    it("throws for an unknown position", async () => {
      await expect(db.transitionPosition("nope", "stop_pending")).rejects.toBeInstanceOf(PositionNotFoundError);
    });
  });

  describe("setTerms", () => {
    it("writes terms, computes the renewal date and keeps the sources in the timeline", async () => {
      const id = await open();
      const position = await db.setTerms(id, TERMS);
      expect(position).toMatchObject({
        renewal_price_cents: 1200,
        currency: "USD",
        cancel_url: "https://notion.so/settings/billing",
        renewal_date: "2026-10-18", // opened 2026-10-04 + 14 days
      });
      const event = (await db.listEvents(id)).find((e) => e.type === "terms.set")!;
      expect(event.payload["source_urls"]).toEqual(TERMS.source_urls);
      expect(event.payload["cancel_policy"]).toBe(TERMS.cancel_policy);
    });

    it("refuses once the position is finished", async () => {
      const id = await open();
      await db.transitionPosition(id, "failed", { reason: "x" });
      await expect(db.setTerms(id, TERMS)).rejects.toBeInstanceOf(PositionNotEditableError);
    });

    it("throws for an unknown position", async () => {
      await expect(db.setTerms("nope", TERMS)).rejects.toBeInstanceOf(PositionNotFoundError);
    });
  });

  describe("events", () => {
    it("appends in order and rejects unknown positions", async () => {
      const id = await open();
      await db.appendEvent(id, "note", { n: 1 });
      await db.appendEvent(id, "note", { n: 2 });
      const notes = (await db.listEvents(id)).filter((e) => e.type === "note");
      expect(notes.map((e) => e.payload["n"])).toEqual([1, 2]);
      await expect(db.appendEvent("nope", "note", {})).rejects.toBeInstanceOf(PositionNotFoundError);
    });
  });

  describe("approvals", () => {
    it("creates a pending request, idempotently", async () => {
      const id = await open();
      const a = await db.createApproval({ position_id: id, kind: "cancel", detail: "Cancel Notion" });
      const b = await db.createApproval({ position_id: id, kind: "cancel", detail: "again" });
      expect(a).toMatchObject({ status: "pending", resolved_at: null, kind: "cancel" });
      expect(b.id).toBe(a.id);
      const other = await db.createApproval({ position_id: id, kind: "retention_offer", detail: "10% off" });
      expect(other.id).not.toBe(a.id);
    });

    it("resolves once; the same decision repeats safely, a different one is refused", async () => {
      const id = await open();
      const a = await db.createApproval({ position_id: id, kind: "cancel", detail: "d" });
      const done = await db.resolveApproval(a.id, "approved");
      expect(done.status).toBe("approved");
      expect(done.resolved_at).not.toBeNull();
      expect(await db.resolveApproval(a.id, "approved")).toEqual(done);
      await expect(db.resolveApproval(a.id, "declined")).rejects.toBeInstanceOf(ApprovalAlreadyResolvedError);
      expect((await db.getApproval(a.id))!.status).toBe("approved");
    });

    it("lists approvals oldest first, optionally by status", async () => {
      const a = await open({ sender_domain: "a.com" }, "a");
      const b = await open({ sender_domain: "b.com" }, "b");
      const first = await db.createApproval({ position_id: a, kind: "cancel", detail: "A" });
      const second = await db.createApproval({ position_id: b, kind: "cancel", detail: "B" });
      await db.resolveApproval(first.id, "approved");
      expect((await db.listApprovals()).map((x) => x.id)).toEqual([first.id, second.id]);
      expect((await db.listApprovals({ status: "pending" })).map((x) => x.id)).toEqual([second.id]);
      expect((await db.listApprovals({ status: "declined" }))).toEqual([]);
    });

    it("allows a new request after the previous one was resolved", async () => {
      const id = await open();
      const a = await db.createApproval({ position_id: id, kind: "cancel", detail: "d" });
      await db.resolveApproval(a.id, "declined");
      const b = await db.createApproval({ position_id: id, kind: "cancel", detail: "d" });
      expect(b.id).not.toBe(a.id);
    });

    it("records approval events on the timeline", async () => {
      const id = await open();
      const a = await db.createApproval({ position_id: id, kind: "cancel", detail: "d" });
      await db.resolveApproval(a.id, "approved");
      const types = (await db.listEvents(id)).map((e) => e.type);
      expect(types).toContain("approval.requested");
      expect(types).toContain("approval.resolved");
    });

    it("throws for unknown ids", async () => {
      await expect(db.resolveApproval("nope", "approved")).rejects.toBeInstanceOf(ApprovalNotFoundError);
      await expect(
        db.createApproval({ position_id: "nope", kind: "cancel", detail: "d" }),
      ).rejects.toBeInstanceOf(PositionNotFoundError);
      expect(await db.getApproval("nope")).toBeNull();
    });
  });

  describe("queries", () => {
    it("sums exposure per currency over open and stop_pending only", async () => {
      const a = await open({ sender_domain: "a.com" }, "a");
      const b = await open({ sender_domain: "b.com" }, "b");
      const c = await open({ sender_domain: "c.com" }, "c");
      const d = await open({ sender_domain: "d.com" }, "d");
      await open({ sender_domain: "e.com" }, "e"); // terms still unknown
      await db.setTerms(a, { ...TERMS, renewal_price_cents: 1000 });
      await db.setTerms(b, { ...TERMS, renewal_price_cents: 500 });
      await db.setTerms(c, { ...TERMS, renewal_price_cents: 700, currency: "EUR" });
      await db.setTerms(d, { ...TERMS, renewal_price_cents: 9999 });
      await db.transitionPosition(b, "stop_pending"); // still exposed
      await db.transitionPosition(d, "failed", { reason: "x" }); // no longer exposed
      expect(await db.getExposure()).toEqual({
        by_currency: { USD: 1500, EUR: 700 },
        unknown_price_count: 1,
      });
    });

    it("exposure drops when a position closes", async () => {
      const id = await open();
      await db.setTerms(id, TERMS);
      expect((await db.getExposure()).by_currency).toEqual({ USD: 1200 });
      await toCancelling(id);
      await db.transitionPosition(id, "closed", { evidence_email_id: "m" });
      expect(await db.getExposure()).toEqual({ by_currency: {}, unknown_price_count: 0 });
    });

    it("lists open positions due within the window, soonest first", async () => {
      const soon = await open({ sender_domain: "soon.com" }, "a");
      const later = await open({ sender_domain: "later.com" }, "b");
      const unknown = await open({ sender_domain: "unknown.com" }, "c");
      await db.setTerms(soon, { ...TERMS, trial_days: 5 }); // renews 2026-10-09
      await db.setTerms(later, { ...TERMS, trial_days: 30 }); // renews 2026-11-03
      void unknown;
      const due = await db.listDueForStop({ today: "2026-10-07", within_days: 3 });
      expect(due.map((p) => p.id)).toEqual([soon]);
      const none = await db.listDueForStop({ today: "2026-10-04", within_days: 1 });
      expect(none).toEqual([]);
      await db.transitionPosition(soon, "stop_pending");
      expect(await db.listDueForStop({ today: "2026-10-07", within_days: 3 })).toEqual([]);
    });

    it("lists positions by status and finds the active one", async () => {
      const a = await open({ sender_domain: "a.com" }, "a");
      const b = await open({ sender_domain: "b.com" }, "b");
      await db.transitionPosition(b, "stop_pending");
      expect((await db.listPositions({ status: ["stop_pending"] })).map((p) => p.id)).toEqual([b]);
      expect(await db.listPositions({ status: [] })).toEqual([]);
      expect((await db.listPositions()).map((p) => p.id).sort()).toEqual([a, b].sort());
      expect((await db.findActivePosition("A.com", "ME@agentmail.to"))!.id).toBe(a);
      expect(await db.findActivePosition("zzz.com", "me@agentmail.to")).toBeNull();
    });
  });
});
