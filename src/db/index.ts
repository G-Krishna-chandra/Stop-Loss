// Public surface of src/db. Other modules import from here and nowhere deeper.
// This is the only module that touches SQL.
export type {
  ApprovalDecision,
  CreateApprovalInput,
  Db,
  DbOptions,
  Exposure,
  IngestEvent,
  IngestResult,
} from "./contract.js";
export {
  ApprovalAlreadyResolvedError,
  ApprovalNotFoundError,
  InvalidTransitionError,
  PositionNotEditableError,
  PositionNotFoundError,
  TransitionContextError,
} from "./errors.js";
export { createMemoryDb } from "./memory.js";
export { createNeonDb, createNeonRunner } from "./neon.js";
export { createPostgresDb, migrate } from "./postgres.js";
export type { Row, SqlRunner } from "./postgres.js";
export {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  canTransition,
} from "./transitions.js";
export type { TransitionContext } from "./transitions.js";
