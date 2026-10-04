import type { PositionStatus } from "../types.js";
import { TransitionContextError } from "./errors.js";

// The position state machine from the stop-loss skill (section 7), as data.
//
//   open -> stop_pending -> approved -> cancelling -> closed
//   stop_pending -> kept (human declined)
//   any LIVE state -> failed
//
// Decision: "any state can go to failed" is read as any non-terminal state. A position that is
// already closed (cancelled, with email proof), kept, or failed is finished; rewriting history
// from closed to failed would corrupt exposure and the audit trail.
//
// Decision: there is no edge from cancelling back to approved. After an uncertain cancel the
// skill says never retry automatically: mark failed and surface it (safety rules, section 8).

export const TRANSITIONS: Readonly<Record<PositionStatus, readonly PositionStatus[]>> = {
  open: ["stop_pending", "failed"],
  stop_pending: ["approved", "kept", "failed"],
  approved: ["cancelling", "failed"],
  cancelling: ["closed", "failed"],
  closed: [],
  kept: [],
  failed: [],
};

export const TERMINAL_STATUSES: readonly PositionStatus[] = ["closed", "kept", "failed"];

/** Statuses a position may be in while it is still being worked on. */
export const ACTIVE_STATUSES: readonly PositionStatus[] = [
  "open",
  "stop_pending",
  "approved",
  "cancelling",
];

export function canTransition(from: PositionStatus, to: PositionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Every status that may move to `to`. This is what the atomic UPDATE checks against. */
export function allowedFrom(to: PositionStatus): PositionStatus[] {
  return (Object.keys(TRANSITIONS) as PositionStatus[]).filter((from) =>
    canTransition(from, to),
  );
}

export interface TransitionContext {
  /** Required for `failed`. Stored in the timeline event. */
  reason?: string;
  /** Required for `closed`. The AgentMail message id of the cancellation email. */
  evidence_email_id?: string;
}

/**
 * Closed means "cancelled, with email proof" (skill vocabulary), so closing without an evidence
 * email id is refused here, in the data layer, not left to every caller to remember.
 */
export function validateContext(to: PositionStatus, ctx: TransitionContext): void {
  if (to === "closed" && !ctx.evidence_email_id?.trim()) {
    throw new TransitionContextError("closing a position requires evidence_email_id");
  }
  if (to === "failed" && !ctx.reason?.trim()) {
    throw new TransitionContextError("failing a position requires a reason");
  }
}
