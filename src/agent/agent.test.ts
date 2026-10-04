import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApprovalService, type ApprovalService } from "../approval/index.js";
import type { Canceller } from "../cancel/index.js";
import { createMemoryDb, type Db, type IngestEvent } from "../db/index.js";
import type { TermsLookup, TermsResult } from "../terms/index.js";
import type { CancelResult, Position } from "../types.js";
import { createAgent, type Agent } from "./agent.js";

const GOOD_TERMS: TermsResult = {
  ok: true,
  official_source: true,
  warnings: [],
  terms: {
    trial_days: 7,
    renewal_price_cents: 1200,
    currency: "USD",
    cancel_policy: "Cancel in Settings.",
    cancel_url: "https://www.notion.so/settings/billing",
    source_urls: ["https://www.notion.so/pricing"],
  },
};

const email = (kind: string, id: string, extra: Record<string, unknown> = {}): IngestEvent => ({
  type: `email.${kind}`,
  dedupe_key: `agentmail:${id}`,
  payload: { kind, message_id: id, sender_domain: "notion.so", recipient_address: "me@agentmail.to", inbox_id: "inbox_1", ...extra },
});

const CANCELLED: CancelResult = { outcome: "cancelled", detail: "Subscription cancelled.", live_view_url: "https://live.example/1", replay_url: "https://replay.example/1" };

describe("agent: the whole loop", () => {
  let db: Db;
  let approval: ApprovalService;
  let agent: Agent;
  let lookupTerms: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  let nowIso: string;

  function build(overrides: { terms?: TermsResult; cancelResult?: CancelResult } = {}) {
    lookupTerms = vi.fn(async () => overrides.terms ?? GOOD_TERMS);
    cancel = vi.fn(async (_p: Position) => overrides.cancelResult ?? CANCELLED);
    const terms: TermsLookup = { lookupTerms: lookupTerms as never };
    const canceller: Canceller = { cancel: cancel as never, cancelMany: async () => [] };
    agent = createAgent({ db, approval, terms, canceller, now: () => new Date(nowIso) });
  }

  beforeEach(() => {
    nowIso = "2026-10-04T18:00:00.000Z";
    db = createMemoryDb({ now: () => new Date(nowIso) });
    approval = createApprovalService({ db });
    build();
  });

  const onlyPosition = async () => (await db.listPositions())[0]!;
  const firstPending = async () => {
    const pending = await approval.listPending();
    if (!pending[0]) throw new Error("expected a pending approval");
    return pending[0].approval;
  };
  const timeline = async (id: string) => (await db.listEvents(id)).map((e) => e.type);

  /** welcome email -> position with terms */
  async function welcome() {
    const result = await agent.emit(email("welcome", "w1"));
    await agent.idle();
    return result.position_id!;
  }

  it("runs the loop end to end: welcome, trial ending, approval, cancel, proof, closed", async () => {
    const id = await welcome();
    expect(await db.getPosition(id)).toMatchObject({ status: "open", renewal_price_cents: 1200, renewal_date: "2026-10-11" });

    await agent.emit(email("trial_ending", "t1"));
    await agent.idle();
    expect((await db.getPosition(id))!.status).toBe("stop_pending");
    const pending = await approval.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.approval.detail).toContain("$12.00");
    expect(cancel).not.toHaveBeenCalled(); // nothing happens without a human

    await approval.resolveApproval(pending[0]!.approval.id, "approved", { via: "test" });
    await agent.idle();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]![0]).toMatchObject({ id, status: "cancelling" });
    expect((await db.getPosition(id))!.status).toBe("cancelling"); // waits for the email proof

    await agent.emit(email("cancellation", "c1"));
    await agent.idle();
    expect(await db.getPosition(id)).toMatchObject({ status: "closed", evidence_email_id: "c1" });
    expect(await db.getExposure()).toEqual({ by_currency: {}, unknown_price_count: 0 });
    expect(await timeline(id)).toEqual(expect.arrayContaining(["terms.set", "approval.requested", "approval.resolved", "cancel.completed"]));
  });

  it("a declined approval keeps the subscription and never cancels", async () => {
    const id = await welcome();
    await agent.emit(email("trial_ending", "t1"));
    await agent.idle();
    const request = await firstPending();
    await approval.resolveApproval(request.id, "declined");
    await agent.idle();
    expect((await db.getPosition(id))!.status).toBe("kept");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("NEVER cancels without an approval, even after a trial-ending email and a sweep", async () => {
    await welcome();
    await agent.emit(email("trial_ending", "t1"));
    nowIso = "2026-10-20T00:00:00.000Z";
    await agent.sweep();
    await agent.idle();
    expect(cancel).not.toHaveBeenCalled();
    expect((await onlyPosition()).status).toBe("stop_pending");
  });

  it("ignores a duplicate delivery of the same email", async () => {
    await welcome();
    await agent.emit(email("trial_ending", "t1"));
    await agent.emit(email("trial_ending", "t1"));
    await agent.idle();
    expect(await approval.listPending()).toHaveLength(1);
    expect(lookupTerms).toHaveBeenCalledTimes(1);
  });

  describe("cancel outcomes", () => {
    async function approveNow() {
      await welcome();
      await agent.emit(email("trial_ending", "t1"));
      await agent.idle();
      const request = await firstPending();
      await approval.resolveApproval(request.id, "approved");
      await agent.idle();
      return onlyPosition();
    }

    it("a retention offer stops and waits for a human, without accepting or declining it", async () => {
      build({ cancelResult: { outcome: "retention_offer", detail: "Stay for 50% off", live_view_url: "https://live.example/1", replay_url: null } });
      const position = await approveNow();
      expect(position.status).toBe("cancelling");
      const pending = await approval.listPending();
      expect(pending.map((p) => [p.approval.kind, p.approval.detail])).toEqual([["retention_offer", "Stay for 50% off"]]);
      expect(cancel).toHaveBeenCalledTimes(1); // no automatic second attempt
    });

    it("needs_login marks the position failed with a reason", async () => {
      build({ cancelResult: { outcome: "needs_login", detail: "login form", live_view_url: null, replay_url: null } });
      const position = await approveNow();
      expect(position.status).toBe("failed");
      const last = (await db.listEvents(position.id)).at(-1)!;
      expect(last.payload["reason"]).toMatch(/needs login/);
    });

    it("a failed cancel marks the position failed and is not retried", async () => {
      build({ cancelResult: { outcome: "failed", detail: "uncertain: do not retry", live_view_url: null, replay_url: null } });
      const position = await approveNow();
      expect(position.status).toBe("failed");
      await agent.sweep();
      await agent.idle();
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("cancellation emails", () => {
    it("an email from another domain cannot close a position", async () => {
      const id = await welcome();
      await db.transitionPosition(id, "stop_pending");
      await db.transitionPosition(id, "approved");
      await db.transitionPosition(id, "cancelling");
      const spoof = await agent.emit(email("cancellation", "c1", { sender_domain: "evil.example" }));
      await agent.idle();
      expect(spoof.position_id).toBeNull();
      expect((await db.getPosition(id))!.status).toBe("cancelling");
    });

    it("a cancellation email before any cancel was started does not close the position", async () => {
      const id = await welcome();
      await agent.emit(email("cancellation", "c1"));
      await agent.idle();
      expect((await db.getPosition(id))!.status).toBe("open");
      expect(await timeline(id)).toContain("cancel.email_ignored");
    });
  });

  describe("terms", () => {
    it("a failed lookup does not block the approval, which then shows an unknown price", async () => {
      build({ terms: { ok: false, reason: "Exa down" } });
      const id = await welcome();
      expect((await db.getPosition(id))!.renewal_price_cents).toBeNull();
      expect(await timeline(id)).toContain("terms.failed");
      await agent.emit(email("trial_ending", "t1"));
      await agent.idle();
      const request = await firstPending();
      expect(request.detail).toContain("unknown price");
    });

    it("stops retrying a failing lookup after three attempts", async () => {
      build({ terms: { ok: false, reason: "nope" } });
      await welcome();
      for (let i = 0; i < 5; i++) await agent.sweep();
      expect(lookupTerms).toHaveBeenCalledTimes(3);
    });

    it("sweep fills in terms that were missing", async () => {
      build({ terms: { ok: false, reason: "nope" } });
      const id = await welcome();
      lookupTerms.mockResolvedValue(GOOD_TERMS);
      const report = await agent.sweep();
      expect(report.terms_filled).toBe(1);
      expect((await db.getPosition(id))!.renewal_price_cents).toBe(1200);
    });
  });

  describe("sweep", () => {
    it("starts the stop flow for a position whose renewal is near", async () => {
      const id = await welcome(); // renews 2026-10-11
      nowIso = "2026-10-09T00:00:00.000Z";
      const report = await agent.sweep();
      expect(report.stops_started).toBe(1);
      expect((await db.getPosition(id))!.status).toBe("stop_pending");
      expect(await approval.listPending()).toHaveLength(1);
      expect((await agent.sweep()).stops_started).toBe(0); // idempotent
      expect(await approval.listPending()).toHaveLength(1);
    });

    it("leaves a far-off renewal alone", async () => {
      const id = await welcome();
      await agent.sweep();
      expect((await db.getPosition(id))!.status).toBe("open");
    });

    it("picks up an approval resolved in ANOTHER process (no resume callback there)", async () => {
      const id = await welcome();
      await agent.emit(email("trial_ending", "t1"));
      await agent.idle();
      const request = await firstPending();

      const otherProcess = createApprovalService({ db }); // like the CLI: records, cannot resume
      await otherProcess.resolveApproval(request.id, "approved", { via: "cli" });
      await agent.idle();
      expect((await db.getPosition(id))!.status).toBe("approved");
      expect(cancel).not.toHaveBeenCalled();

      const report = await agent.sweep();
      await agent.idle();
      expect(report.approved_resumed).toBe(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect((await db.getPosition(id))!.status).toBe("cancelling");
    });

    it("cancels an approved position directly when its workflow run is gone, still exactly once", async () => {
      const id = await welcome();
      // Approved with no workflow run at all (e.g. a crash lost it).
      await db.transitionPosition(id, "stop_pending");
      await db.transitionPosition(id, "approved");
      const report = await agent.sweep();
      expect(report.approved_cancelled_directly).toBe(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      await agent.sweep();
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("the callback and the sweep together still cancel only once", async () => {
      await welcome();
      await agent.emit(email("trial_ending", "t1"));
      await agent.idle();
      const request = await firstPending();
      await approval.resolveApproval(request.id, "approved");
      await agent.sweep(); // races the background resume
      await agent.idle();
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  });
});
