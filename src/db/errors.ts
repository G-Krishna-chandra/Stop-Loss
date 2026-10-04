// Typed errors so callers (src/agent, src/approval) can react to the cases that matter
// without parsing messages.

export class PositionNotFoundError extends Error {
  constructor(readonly position_id: string) {
    super(`position not found: ${position_id}`);
  }
}

/** The requested status change is not allowed from the position's current status. */
export class InvalidTransitionError extends Error {
  constructor(
    readonly position_id: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`invalid transition for ${position_id}: ${from} -> ${to}`);
  }
}

/** A required piece of context is missing, e.g. closing without email proof. */
export class TransitionContextError extends Error {}

/** Terms can only be written while a position is still live (open or stop_pending). */
export class PositionNotEditableError extends Error {
  constructor(
    readonly position_id: string,
    readonly status: string,
  ) {
    super(`position ${position_id} is ${status} and can no longer be edited`);
  }
}

export class ApprovalNotFoundError extends Error {
  constructor(readonly approval_id: string) {
    super(`approval not found: ${approval_id}`);
  }
}

/** The approval was already resolved with a different decision. */
export class ApprovalAlreadyResolvedError extends Error {
  constructor(
    readonly approval_id: string,
    readonly status: string,
  ) {
    super(`approval ${approval_id} is already ${status}`);
  }
}
