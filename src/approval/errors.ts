// Typed errors for src/approval. Errors from src/db (PositionNotFoundError,
// ApprovalNotFoundError, ApprovalAlreadyResolvedError) pass through unchanged.

/** An approval of this kind cannot be requested while the position is in this status. */
export class ApprovalNotAllowedError extends Error {
  constructor(
    readonly position_id: string,
    readonly kind: string,
    readonly status: string,
  ) {
    super(`cannot request a ${kind} approval for ${position_id} while it is ${status}`);
  }
}

/**
 * The position moved on (failed, closed, ...) while the request waited, so the decision can no
 * longer take effect. The approval is left as it was.
 */
export class PositionChangedError extends Error {
  constructor(
    readonly position_id: string,
    readonly status: string,
    readonly wanted: string,
  ) {
    super(`position ${position_id} is ${status}, so the decision (-> ${wanted}) cannot be applied`);
  }
}

/**
 * The decision IS saved, but a resume handler failed, so the workflow may still be waiting.
 * Calling resolveApproval again with the same decision is safe and re-delivers to the handlers.
 */
export class ResumeFailedError extends Error {
  constructor(
    readonly approval_id: string,
    readonly causes: unknown[],
  ) {
    super(`decision saved for ${approval_id}, but ${causes.length} resume handler(s) failed`);
  }
}
