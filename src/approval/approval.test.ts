import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalAlreadyResolvedError,
  ApprovalNotFoundError,
  PositionNotFoundError,
  createMemoryDb,
  type Db,
} from "../db/index.js";
import { describeCancel, formatMoney, sanitizeDetail } from "./detail.js";
import { ApprovalNotAllowedError, PositionChangedError, ResumeFailedError } from "./errors.js";
import { createApprovalService, type ApprovalService, type Resolution } from "./service.js";

const TERMS = {
  trial_days: 14,
  renewal_price_cents: 1200,
  currency: "USD",
  cancel_policy: "Cancel in Settings.",
  cancel_url: "https://notion.so/settings",
  source_urls: ["https://notion.so/help"],
};

describe("approval service", () => {
  let db: Db;
  let svc: ApprovalService;
  let positionId: string;

  beforeEach(async () => {
    db = createMemoryDb({ now: () => new Date("2026-10-04T18:00:00.000Z") });
    svc = createApprovalService({ db });
    const result = await db.emit({
      type: "email.welcome",
      dedupe_key: "agentmail:w1",
      payload: { sender_domain: "notion.so", recipient_address: "me@agentmail.to" },
    });
    positionId = result.position_id!;
    await db.setTerms(positionId, TERMS);
  });

  const status = async () => (await db.getPosition(positionId))!.status;

  describe("requestApproval", () => {
    it("moves an open position to stop_pending and returns the request id", async () => {
      const id = await svc.requestApproval(positionId);
      expect(await status()).toBe("stop_pending");
      const approval = (await db.getApproval(id))!;
      expect(approval).toMatchObject({ kind: "cancel", status: "pending", position_id: positionId });
      expect(approval.detail).toBe("Cancel Notion (notion.so) before it renews on 2026-10-18 for $12.00.");
    });

    it("accepts a Position object and ignores its stale copy", async () => {
      const stale = { ...(await db.getPosition(positionId))!, status: "open" as const };
      const id = await svc.requestApproval(stale);
      expect((await db.getApproval(id))!.position_id).toBe(positionId);
    });

    it("is idempotent", async () => {
      const a = await svc.requestApproval(positionId);
      const b = await svc.requestApproval(positionId);
      expect(b).toBe(a);
      expect(await db.listApprovals()).toHaveLength(1);
    });

    it("refuses positions that are not cancellable", async () => {
      const id = await svc.requestApproval(positionId);
      await svc.resolveApproval(id, "approved");
      await expect(svc.requestApproval(positionId)).rejects.toBeInstanceOf(ApprovalNotAllowedError);
    });

    it("throws for an unknown position", async () => {
      await expect(svc.requestApproval("nope")).rejects.toBeInstanceOf(PositionNotFoundError);
    });

    it("never approves anything by itself", async () => {
      await svc.requestApproval(positionId);
      expect(await status()).toBe("stop_pending");
      expect((await db.listApprovals())[0]!.status).toBe("pending");
    });

    it("says so when the price is unknown", async () => {
      const bare = await db.emit({
        type: "email.welcome",
        dedupe_key: "agentmail:w2",
        payload: { sender_domain: "linear.app", recipient_address: "me@agentmail.to" },
      });
      const id = await svc.requestApproval(bare.position_id!);
      expect((await db.getApproval(id))!.detail).toContain("unknown price");
    });
  });

  describe("resolveApproval", () => {
    it("approve: records the decision, approves the position, resumes the waiter", async () => {
      const seen: Resolution[] = [];
      svc.onResolved((r) => void seen.push(r));
      const id = await svc.requestApproval(positionId);
      const result = await svc.resolveApproval(id, "approved", { via: "cli" });
      expect(result.approval).toMatchObject({ status: "approved" });
      expect(result.position.status).toBe("approved");
      expect(await status()).toBe("approved");
      expect(seen).toHaveLength(1);
      expect(seen[0]!.approval.id).toBe(id);
    });

    it("decline: keeps the subscription and the position goes to kept", async () => {
      const id = await svc.requestApproval(positionId);
      const result = await svc.resolveApproval(id, "declined");
      expect(result.position.status).toBe("kept");
      expect(await status()).toBe("kept");
    });

    it("repeating the same decision is safe and re-delivers to the handlers", async () => {
      const handler = vi.fn();
      svc.onResolved(handler);
      const id = await svc.requestApproval(positionId);
      await svc.resolveApproval(id, "approved");
      const again = await svc.resolveApproval(id, "approved");
      expect(again.position.status).toBe("approved");
      expect(handler).toHaveBeenCalledTimes(2); // at-least-once: handlers must be idempotent
      const changes = (await db.listEvents(positionId)).filter((e) => e.payload["to"] === "approved");
      expect(changes).toHaveLength(1);
    });

    it("repeating an approve after the flow moved on succeeds and changes nothing", async () => {
      const handler = vi.fn();
      svc.onResolved(handler);
      const id = await svc.requestApproval(positionId);
      await svc.resolveApproval(id, "approved");
      await db.transitionPosition(positionId, "cancelling"); // the cancel has started
      const again = await svc.resolveApproval(id, "approved"); // e.g. a double click
      expect(again.approval.status).toBe("approved");
      expect(again.position.status).toBe("cancelling");
      expect(await status()).toBe("cancelling");
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("repeating a decline after the position was kept succeeds", async () => {
      const id = await svc.requestApproval(positionId);
      await svc.resolveApproval(id, "declined");
      expect((await svc.resolveApproval(id, "declined")).position.status).toBe("kept");
    });

    it("heals a crash between saving the decision and applying it", async () => {
      const id = await svc.requestApproval(positionId);
      await db.resolveApproval(id, "approved"); // decision saved, position still stop_pending
      expect(await status()).toBe("stop_pending");
      const healed = await svc.resolveApproval(id, "approved");
      expect(healed.position.status).toBe("approved");
    });

    it("refuses the opposite decision and changes nothing", async () => {
      const handler = vi.fn();
      const id = await svc.requestApproval(positionId);
      await svc.resolveApproval(id, "approved");
      svc.onResolved(handler);
      await expect(svc.resolveApproval(id, "declined")).rejects.toBeInstanceOf(ApprovalAlreadyResolvedError);
      expect(await status()).toBe("approved");
      expect(handler).not.toHaveBeenCalled();
    });

    it("refuses a moot decision and leaves the request pending", async () => {
      const id = await svc.requestApproval(positionId);
      await db.transitionPosition(positionId, "failed", { reason: "service shut down" });
      await expect(svc.resolveApproval(id, "approved")).rejects.toBeInstanceOf(PositionChangedError);
      expect((await db.getApproval(id))!.status).toBe("pending");
      expect(await status()).toBe("failed");
    });

    it("saves the decision even if a handler fails, and a retry re-delivers", async () => {
      let attempts = 0;
      svc.onResolved(() => {
        attempts += 1;
        if (attempts === 1) throw new Error("workflow engine down");
      });
      const id = await svc.requestApproval(positionId);
      await expect(svc.resolveApproval(id, "approved")).rejects.toBeInstanceOf(ResumeFailedError);
      expect(await status()).toBe("approved"); // saved
      const retry = await svc.resolveApproval(id, "approved");
      expect(retry.position.status).toBe("approved");
      expect(attempts).toBe(2);
    });

    it("keeps calling the other handlers when one fails", async () => {
      const second = vi.fn();
      svc.onResolved(() => {
        throw new Error("boom");
      });
      svc.onResolved(second);
      const id = await svc.requestApproval(positionId);
      await expect(svc.resolveApproval(id, "approved")).rejects.toBeInstanceOf(ResumeFailedError);
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("stops calling a handler after it unsubscribes", async () => {
      const handler = vi.fn();
      const off = svc.onResolved(handler);
      off();
      const id = await svc.requestApproval(positionId);
      await svc.resolveApproval(id, "approved");
      expect(handler).not.toHaveBeenCalled();
    });

    it("records where the decision came from", async () => {
      const id = await svc.requestApproval(positionId);
      await svc.resolveApproval(id, "approved", { via: "cli" });
      const event = (await db.listEvents(positionId)).find((e) => e.type === "approval.decided_via");
      expect(event?.payload).toMatchObject({ approval_id: id, decision: "approved", via: "cli" });
    });

    it("throws for an unknown request", async () => {
      await expect(svc.resolveApproval("nope", "approved")).rejects.toBeInstanceOf(ApprovalNotFoundError);
    });

    it("two surfaces racing with different decisions: exactly one wins", async () => {
      const id = await svc.requestApproval(positionId);
      const results = await Promise.allSettled([
        svc.resolveApproval(id, "approved"),
        svc.resolveApproval(id, "declined"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const final = await status();
      expect(["approved", "kept"]).toContain(final);
    });
  });

  describe("retention offers", () => {
    async function toCancelling() {
      const id = await svc.requestApproval(positionId);
      await svc.resolveApproval(id, "approved");
      await db.transitionPosition(positionId, "cancelling");
    }

    it("needs a cancelling position and the offer text", async () => {
      await expect(
        svc.requestApproval(positionId, { kind: "retention_offer", detail: "50% off" }),
      ).rejects.toBeInstanceOf(ApprovalNotAllowedError);
      await toCancelling();
      await expect(svc.requestApproval(positionId, { kind: "retention_offer" })).rejects.toThrow(/offer text/);
    });

    it("waits for a human and does not touch the position", async () => {
      await toCancelling();
      const id = await svc.requestApproval(positionId, {
        kind: "retention_offer",
        detail: "Stay for 50% off for 3 months",
      });
      expect((await db.getApproval(id))!.status).toBe("pending");
      expect(await status()).toBe("cancelling");
      const result = await svc.resolveApproval(id, "declined");
      expect(result.position.status).toBe("cancelling"); // the cancel flow decides what is next
    });
  });

  describe("listPending", () => {
    it("returns pending requests with their positions", async () => {
      const id = await svc.requestApproval(positionId);
      const pending = await svc.listPending();
      expect(pending.map((p) => p.approval.id)).toEqual([id]);
      expect(pending[0]!.position.service_name).toBe("Notion");
      await svc.resolveApproval(id, "declined");
      expect(await svc.listPending()).toEqual([]);
    });
  });
});

describe("detail text", () => {
  it("formats money", () => {
    expect(formatMoney(1200, "USD")).toBe("$12.00");
    expect(formatMoney(999, "NOPE")).toBe("9.99 NOPE");
  });

  it("cleans text that came from a web page", () => {
    const dirty = `Stay‮ for\n50%\u0000 off ${"x".repeat(900)}`;
    const clean = sanitizeDetail(dirty);
    expect(clean.length).toBeLessThanOrEqual(500);
    expect(clean).not.toMatch(/[‮\u0000\n]/);
  });

  it("describes a cancel", () => {
    expect(
      describeCancel({
        id: "p",
        service_name: "Notion",
        service_domain: "notion.so",
        signup_email: "me@x.com",
        opened_at: "2026-10-04T18:00:00.000Z",
        renewal_date: "2026-10-18",
        renewal_price_cents: 1200,
        currency: "USD",
        cancel_url: null,
        status: "stop_pending",
        evidence_email_id: null,
      }),
    ).toBe("Cancel Notion (notion.so) before it renews on 2026-10-18 for $12.00.");
  });
});
