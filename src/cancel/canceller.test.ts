import { describe, expect, it, vi } from "vitest";
import type { Position } from "../types.js";
import { createCanceller } from "./canceller.js";
import type { ExecuteResult, KernelApi } from "./kernel.js";

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    service_name: "Notion",
    service_domain: "notion.so",
    signup_email: "me@agentmail.to",
    opened_at: "2026-10-04T18:00:00.000Z",
    renewal_date: "2026-10-18",
    renewal_price_cents: 1200,
    currency: "USD",
    cancel_url: "https://www.notion.so/settings/billing",
    status: "cancelling",
    evidence_email_id: null,
    ...overrides,
  };
}

interface FakeOptions {
  execute?: (code: string) => Promise<ExecuteResult>;
  create?: () => Promise<void>;
  replay?: "ok" | "fail";
}

function fakeKernel(opts: FakeOptions = {}) {
  let n = 0;
  const calls: string[] = [];
  const api: KernelApi & { calls: string[]; codes: string[] } = {
    calls,
    codes: [],
    async createBrowser() {
      calls.push("create");
      if (opts.create) await opts.create();
      n += 1;
      return { session_id: `s${n}`, live_view_url: `https://live.example/s${n}` };
    },
    async startReplay() {
      calls.push("startReplay");
      if (opts.replay === "fail") throw new Error("replay unavailable");
      return { replay_id: "r1" };
    },
    async execute(_id, code) {
      calls.push("execute");
      api.codes.push(code);
      return opts.execute ? opts.execute(code) : { success: true, result: { outcome: "cancelled", detail: "Subscription cancelled." } };
    },
    async stopReplay() {
      calls.push("stopReplay");
    },
    async replayViewUrl() {
      calls.push("replayUrl");
      return "https://replay.example/r1";
    },
    async deleteBrowser() {
      calls.push("delete");
    },
  };
  return api;
}

describe("canceller", () => {
  it("cancels, returns live view and replay, and cleans up", async () => {
    const kernel = fakeKernel();
    const result = await createCanceller({ kernel }).cancel(position());
    expect(result).toEqual({
      outcome: "cancelled",
      detail: "Subscription cancelled.",
      live_view_url: "https://live.example/s1",
      replay_url: "https://replay.example/r1",
    });
    expect(kernel.calls).toEqual(["create", "startReplay", "execute", "stopReplay", "replayUrl", "delete"]);
  });

  it.each(["open", "stop_pending", "approved", "closed", "kept", "failed"] as const)(
    "refuses a %s position and never opens a browser",
    async (status) => {
      const kernel = fakeKernel();
      const result = await createCanceller({ kernel }).cancel(position({ status }));
      expect(result.outcome).toBe("failed");
      expect(result.detail).toMatch(/refused/);
      expect(kernel.calls).toEqual([]);
    },
  );

  it.each([null, "", "http://notion.so/cancel", "javascript:alert(1)"])("refuses cancel_url %j", async (cancel_url) => {
    const kernel = fakeKernel();
    const result = await createCanceller({ kernel }).cancel(position({ cancel_url }));
    expect(result.outcome).toBe("failed");
    expect(kernel.calls).toEqual([]);
  });

  it("reports a retention offer without acting on it", async () => {
    const kernel = fakeKernel({
      execute: async () => ({ success: true, result: { outcome: "retention_offer", detail: "Stay for 50% off for 3 months" } }),
    });
    const result = await createCanceller({ kernel }).cancel(position());
    expect(result).toMatchObject({ outcome: "retention_offer", detail: "Stay for 50% off for 3 months" });
    expect(kernel.calls.filter((c) => c === "execute")).toHaveLength(1);
  });

  it("reports needs_login", async () => {
    const kernel = fakeKernel({
      execute: async () => ({ success: true, result: { outcome: "needs_login", detail: "login form" } }),
    });
    expect((await createCanceller({ kernel }).cancel(position())).outcome).toBe("needs_login");
  });

  it("never retries: a thrown execute is one attempt, marked failed with a warning", async () => {
    const kernel = fakeKernel({
      execute: async () => {
        throw new Error("socket hang up");
      },
    });
    const result = await createCanceller({ kernel }).cancel(position());
    expect(result.outcome).toBe("failed");
    expect(result.detail).toMatch(/uncertain/);
    expect(result.detail).toMatch(/Do not retry automatically/);
    expect(kernel.calls.filter((c) => c === "execute")).toHaveLength(1);
    expect(kernel.calls).toContain("delete"); // the browser is still cleaned up
  });

  it("treats success:false and unreadable results as failed, not cancelled", async () => {
    for (const execute of [
      async (): Promise<ExecuteResult> => ({ success: false, error: "TimeoutError" }),
      async (): Promise<ExecuteResult> => ({ success: true, result: "all done!" }),
      async (): Promise<ExecuteResult> => ({ success: true, result: { outcome: "cancelled" } }),
      async (): Promise<ExecuteResult> => ({ success: true, result: { outcome: "maybe", detail: "x" } }),
      async (): Promise<ExecuteResult> => ({ success: true }),
    ]) {
      const kernel = fakeKernel({ execute });
      const result = await createCanceller({ kernel }).cancel(position());
      expect(result.outcome).toBe("failed");
      expect(kernel.calls.filter((c) => c === "execute")).toHaveLength(1);
    }
  });

  it("says nothing was attempted when the browser cannot start", async () => {
    const kernel = fakeKernel({
      create: async () => {
        throw new Error("quota exceeded");
      },
    });
    const result = await createCanceller({ kernel }).cancel(position());
    expect(result.outcome).toBe("failed");
    expect(result.detail).toMatch(/nothing was attempted/);
    expect(kernel.calls).toEqual(["create"]);
  });

  it("still cancels when the replay cannot start", async () => {
    const kernel = fakeKernel({ replay: "fail" });
    const result = await createCanceller({ kernel }).cancel(position());
    expect(result).toMatchObject({ outcome: "cancelled", replay_url: null });
  });

  it("publishes the live view early, and a broken hook does not matter", async () => {
    const seen: string[] = [];
    const kernel = fakeKernel();
    const ok = await createCanceller({ kernel, hooks: { onLiveView: (id, url) => void seen.push(`${id} ${url}`) } }).cancel(position());
    expect(seen).toEqual(["p1 https://live.example/s1"]);
    expect(ok.outcome).toBe("cancelled");
    const broken = await createCanceller({
      kernel: fakeKernel(),
      hooks: {
        onLiveView: () => {
          throw new Error("ui down");
        },
      },
    }).cancel(position());
    expect(broken.outcome).toBe("cancelled");
  });

  it("loads the shared profile read-only and passes the recipe the cancel URL as data", async () => {
    const createBrowser = vi.fn(async (_options: unknown) => ({ session_id: "s1", live_view_url: null }));
    const kernel = { ...fakeKernel(), createBrowser };
    await createCanceller({ kernel, profileName: "stoploss" }).cancel(position());
    expect(createBrowser).toHaveBeenCalledWith(expect.objectContaining({ profile_name: "stoploss" }));
    expect(createBrowser.mock.calls[0]![0]).not.toHaveProperty("save_changes");
  });

  it("cannot be code-injected through the position's strings", async () => {
    const kernel = fakeKernel();
    const evil = 'https://notion.so/x"; process.exit(1); //';
    await createCanceller({ kernel }).cancel(position({ cancel_url: evil, service_name: '"; evil(); "' }));
    const code = kernel.codes[0]!;
    expect(code).toContain(JSON.stringify({ cancel_url: evil }));
    expect(code).not.toContain("evil()");
  });

  it("cleans the detail text coming from a web page", async () => {
    const kernel = fakeKernel({
      execute: async () => ({ success: true, result: { outcome: "cancelled", detail: `ok‮\n${"x".repeat(900)}` } }),
    });
    const { detail } = await createCanceller({ kernel }).cancel(position());
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(detail).not.toMatch(/[‮\n]/);
  });

  describe("cancelMany", () => {
    it("runs in parallel up to the limit and keeps input order", async () => {
      let active = 0;
      let peak = 0;
      const kernel = fakeKernel({
        execute: async (code) => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 15));
          active -= 1;
          return { success: true, result: { outcome: "cancelled", detail: code.includes("a.com") ? "A" : "B" } };
        },
      });
      const positions = Array.from({ length: 6 }, (_, i) =>
        position({ id: `p${i}`, cancel_url: `https://${i % 2 === 0 ? "a" : "b"}.com/cancel` }),
      );
      const results = await createCanceller({ kernel, maxParallel: 3 }).cancelMany(positions);
      expect(peak).toBe(3);
      expect(results.map((r) => r.detail)).toEqual(["A", "B", "A", "B", "A", "B"]);
      expect(kernel.calls.filter((c) => c === "delete")).toHaveLength(6);
    });

    it("one failure does not stop the others, and it never throws", async () => {
      let n = 0;
      const kernel = fakeKernel({
        execute: async () => {
          n += 1;
          if (n === 2) throw new Error("boom");
          return { success: true, result: { outcome: "cancelled", detail: "ok" } };
        },
      });
      const results = await createCanceller({ kernel, maxParallel: 1 }).cancelMany([position({ id: "a" }), position({ id: "b" }), position({ id: "c" })]);
      expect(results.map((r) => r.outcome)).toEqual(["cancelled", "failed", "cancelled"]);
    });

    it("handles an empty list", async () => {
      expect(await createCanceller({ kernel: fakeKernel() }).cancelMany([])).toEqual([]);
    });
  });
});
