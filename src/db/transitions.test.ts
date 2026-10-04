import { describe, expect, it } from "vitest";
import { POSITION_STATUSES } from "../types.js";
import { TransitionContextError } from "./errors.js";
import {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  allowedFrom,
  canTransition,
  validateContext,
} from "./transitions.js";

describe("state machine", () => {
  it("covers every status in types.ts", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...POSITION_STATUSES].sort());
    expect([...ACTIVE_STATUSES, ...TERMINAL_STATUSES].sort()).toEqual([...POSITION_STATUSES].sort());
  });

  it("allows the happy path", () => {
    expect(canTransition("open", "stop_pending")).toBe(true);
    expect(canTransition("stop_pending", "approved")).toBe(true);
    expect(canTransition("approved", "cancelling")).toBe(true);
    expect(canTransition("cancelling", "closed")).toBe(true);
  });

  it("lets a human decline from stop_pending only", () => {
    expect(allowedFrom("kept")).toEqual(["stop_pending"]);
  });

  it("has no way out of a terminal status", () => {
    for (const status of TERMINAL_STATUSES) expect(TRANSITIONS[status]).toEqual([]);
  });

  it("lets every live status fail", () => {
    for (const status of ACTIVE_STATUSES) expect(canTransition(status, "failed")).toBe(true);
  });

  it("only reaches closed from cancelling, and never skips approval", () => {
    expect(allowedFrom("closed")).toEqual(["cancelling"]);
    expect(allowedFrom("cancelling")).toEqual(["approved"]);
    expect(canTransition("open", "approved")).toBe(false);
    expect(canTransition("open", "cancelling")).toBe(false);
  });

  it("never retries a cancel: cancelling cannot go back to approved", () => {
    expect(canTransition("cancelling", "approved")).toBe(false);
  });
});

describe("validateContext", () => {
  it("requires email proof to close", () => {
    expect(() => validateContext("closed", {})).toThrow(TransitionContextError);
    expect(() => validateContext("closed", { evidence_email_id: "  " })).toThrow(TransitionContextError);
    expect(() => validateContext("closed", { evidence_email_id: "msg_1" })).not.toThrow();
  });

  it("requires a reason to fail", () => {
    expect(() => validateContext("failed", {})).toThrow(TransitionContextError);
    expect(() => validateContext("failed", { reason: "needs login" })).not.toThrow();
  });

  it("asks for nothing on other transitions", () => {
    expect(() => validateContext("approved", {})).not.toThrow();
  });
});
