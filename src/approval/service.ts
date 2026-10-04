import {
  ApprovalNotFoundError,
  InvalidTransitionError,
  PositionNotFoundError,
  type ApprovalDecision,
  type Db,
} from "../db/index.js";
import type { ApprovalKind, ApprovalRequest, Position } from "../types.js";
import { describeCancel, sanitizeDetail } from "./detail.js";
import { ApprovalNotAllowedError, PositionChangedError, ResumeFailedError } from "./errors.js";

// The single door between "the agent wants to do something risky" and "a human said yes".
// Any surface (CLI, HTTP, web UI, email, voice) calls resolveApproval(id, decision) and nothing
// else, so no other module needs to know which surface exists (stop-loss skill, section 3).
//
// Safety invariants this module owns:
//  - A position reaches `approved` ONLY through resolveApproval(id, "approved") on a cancel
//    request. There is no other code path, so there is no auto-cancel.
//  - Email, model output and web pages never call this. The inbox only emits events.
//  - The decision is written before anything resumes, and every step is safe to repeat.

export interface Resolution {
  approval: ApprovalRequest;
  position: Position;
}

export type ResolvedHandler = (resolution: Resolution) => void | Promise<void>;

export interface PendingApproval {
  approval: ApprovalRequest;
  position: Position;
}

export interface RequestOptions {
  /** Defaults to "cancel". */
  kind?: ApprovalKind;
  /** Required for "retention_offer" (the offer text). Generated for "cancel". */
  detail?: string;
}

export interface ResolveMeta {
  /** Free-form label of where the decision came from ("cli", "http", ...). Audit only. */
  via?: string;
}

export interface ApprovalService {
  /** Creates a pending request and returns its id. Safe to call twice. */
  requestApproval(position: Position | string, options?: RequestOptions): Promise<string>;
  /**
   * Records the human's decision, applies it to the position, then resumes whoever is waiting.
   * Repeating the same call is safe; a different decision for the same request is refused.
   */
  resolveApproval(id: string, decision: ApprovalDecision, meta?: ResolveMeta): Promise<Resolution>;
  listPending(): Promise<PendingApproval[]>;
  /** Registers a resume callback (src/agent uses this). Returns an unsubscribe function. */
  onResolved(handler: ResolvedHandler): () => void;
}

export function createApprovalService(deps: { db: Db }): ApprovalService {
  const { db } = deps;
  const handlers = new Set<ResolvedHandler>();

  async function requirePosition(id: string): Promise<Position> {
    const position = await db.getPosition(id);
    if (!position) throw new PositionNotFoundError(id);
    return position;
  }

  return {
    async requestApproval(positionOrId, options = {}) {
      const kind = options.kind ?? "cancel";
      const id = typeof positionOrId === "string" ? positionOrId : positionOrId.id;
      // Never trust the caller's copy of the position. The database is the source of truth.
      let position = await requirePosition(id);

      let detail: string;
      if (kind === "cancel") {
        if (position.status === "open") {
          try {
            position = await db.transitionPosition(id, "stop_pending");
          } catch (error) {
            if (!(error instanceof InvalidTransitionError)) throw error;
            position = await requirePosition(id); // someone else moved it first; re-judge below
          }
        }
        if (position.status !== "stop_pending") {
          throw new ApprovalNotAllowedError(id, kind, position.status);
        }
        detail = options.detail ? sanitizeDetail(options.detail) : describeCancel(position);
      } else {
        if (position.status !== "cancelling") {
          throw new ApprovalNotAllowedError(id, kind, position.status);
        }
        detail = sanitizeDetail(options.detail ?? "");
        if (detail === "") throw new Error("a retention_offer approval needs the offer text as detail");
      }

      const approval = await db.createApproval({ position_id: id, kind, detail });
      return approval.id;
    },

    async resolveApproval(id, decision, meta = {}) {
      const existing = await db.getApproval(id);
      if (!existing) throw new ApprovalNotFoundError(id);
      const wasPending = existing.status === "pending";

      // Refuse a moot decision before recording it, so the audit trail never says "approved"
      // for a position that had already failed.
      const target: Position["status"] | null =
        existing.kind === "cancel" ? (decision === "approved" ? "approved" : "kept") : null;
      if (wasPending && target) {
        const current = await requirePosition(existing.position_id);
        if (current.status !== "stop_pending") {
          throw new PositionChangedError(current.id, current.status, target);
        }
      }

      const approval = await db.resolveApproval(id, decision); // throws if a different decision was stored

      let position = await requirePosition(approval.position_id);
      if (target && position.status !== target) {
        if (position.status === "stop_pending") {
          try {
            position = await db.transitionPosition(approval.position_id, target);
          } catch (error) {
            if (!(error instanceof InvalidTransitionError)) throw error;
            position = await requirePosition(approval.position_id);
            if (position.status !== target && wasPending) {
              throw new PositionChangedError(position.id, position.status, target);
            }
          }
        } else if (wasPending) {
          // Only reachable if the position moved between the pre-check and now.
          throw new PositionChangedError(position.id, position.status, target);
        }
        // Not pending and already past stop_pending: a repeat of a decision that was applied
        // earlier (the flow has moved on). Nothing to do; fall through and return the result.
      }

      if (wasPending && meta.via) {
        await db.appendEvent(approval.position_id, "approval.decided_via", {
          approval_id: approval.id,
          decision,
          via: meta.via,
        });
      }

      // At-least-once delivery: handlers must tolerate repeats (resuming a run that already
      // resumed is a no-op). That is what lets a crash between "saved" and "resumed" heal itself
      // when the same call is repeated.
      const resolution: Resolution = { approval, position };
      const causes: unknown[] = [];
      for (const handler of [...handlers]) {
        try {
          await handler(resolution);
        } catch (error) {
          causes.push(error);
        }
      }
      if (causes.length > 0) throw new ResumeFailedError(approval.id, causes);
      return resolution;
    },

    async listPending() {
      const approvals = await db.listApprovals({ status: "pending" });
      const out: PendingApproval[] = [];
      for (const approval of approvals) {
        out.push({ approval, position: await requirePosition(approval.position_id) });
      }
      return out;
    },

    onResolved(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
