import type {
  ApprovalKind,
  ApprovalRequest,
  Event,
  IsoDate,
  Position,
  PositionStatus,
  Terms,
} from "../types.js";
import type { TransitionContext } from "./transitions.js";

// The contract every storage backend implements (in-memory for dev and tests, Postgres/Neon for
// real). Callers depend on this interface only, so the backend can change without touching them.
// All methods are plain closures, not class methods, so `db.emit` can be passed around detached.

/**
 * What src/inbox hands over. Structurally the same as inbox's InboxEvent, declared here so this
 * module never imports another module's internals. `payload` is untrusted metadata (sanitized by
 * inbox) and is only ever stored as data.
 */
export interface IngestEvent {
  type: string;
  dedupe_key: string;
  payload: object;
}

export interface IngestResult {
  /** True when this dedupe_key was already recorded. Nothing was written. */
  duplicate: boolean;
  /** The position this email belongs to, if any. A welcome email opens one. */
  position_id: string | null;
}

export interface CreateApprovalInput {
  position_id: string;
  kind: ApprovalKind;
  detail: string;
}

export type ApprovalDecision = "approved" | "declined";

/**
 * Exposure is the sum of renewal_price_cents over open and stop_pending positions. Prices in
 * different currencies cannot be added, so the total is per currency. Positions whose terms are
 * not known yet are counted separately instead of being silently treated as zero.
 */
export interface Exposure {
  by_currency: Record<string, number>;
  unknown_price_count: number;
}

export interface Db {
  /** Records an inbox event idempotently and opens a position for a welcome email. */
  emit(event: IngestEvent): Promise<IngestResult>;

  getPosition(id: string): Promise<Position | null>;
  listPositions(filter?: { status?: readonly PositionStatus[] }): Promise<Position[]>;
  /** The live (non-terminal) position for this service and signup address, if any. */
  findActivePosition(service_domain: string, signup_email: string): Promise<Position | null>;

  /** Writes terms onto a live position and records the full terms (with sources) as an event. */
  setTerms(position_id: string, terms: Terms): Promise<Position>;

  /**
   * Atomic compare-and-set. The change only happens if the current status allows it, so two
   * workers racing for the same transition cannot both win. The loser gets InvalidTransitionError.
   */
  transitionPosition(
    position_id: string,
    to: PositionStatus,
    ctx?: TransitionContext,
  ): Promise<Position>;

  /** Appends to a position's timeline. */
  appendEvent(position_id: string, type: string, payload: object): Promise<Event>;
  listEvents(position_id: string): Promise<Event[]>;

  /** Idempotent: if a pending approval of this kind exists for the position, it is returned. */
  createApproval(input: CreateApprovalInput): Promise<ApprovalRequest>;
  getApproval(id: string): Promise<ApprovalRequest | null>;
  /**
   * Records the decision once. Repeating the same decision returns the stored result;
   * a different decision throws ApprovalAlreadyResolvedError. This only records. Resuming the
   * workflow and moving the position's status is src/approval's job.
   */
  resolveApproval(id: string, decision: ApprovalDecision): Promise<ApprovalRequest>;

  getExposure(): Promise<Exposure>;

  /** Open positions whose renewal date falls on or before `today + within_days`. */
  listDueForStop(opts: { today: IsoDate; within_days: number }): Promise<Position[]>;
}

export interface DbOptions {
  /** Injectable clock, for deterministic tests. */
  now?: () => Date;
  /** Injectable id generator, for deterministic tests. */
  newId?: () => string;
}
