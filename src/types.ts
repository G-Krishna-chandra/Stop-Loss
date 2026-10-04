// Shared types. Mirrors section 7 (Data model) of .claude/skills/stop-loss/SKILL.md.
// Change this file only in its own small PR, and tell the team.
// Field names are snake_case to match the database columns.

/** ISO 8601 timestamp, for example "2026-10-04T18:30:00.000Z". */
export type IsoTimestamp = string;

/** ISO 8601 calendar date, for example "2026-11-04". */
export type IsoDate = string;

/**
 * Position status state machine:
 *   open -> stop_pending -> approved -> cancelling -> closed
 * Any state can go to `failed` (the reason goes in an Event payload).
 * `stop_pending` can go to `kept` when the human declines.
 */
export const POSITION_STATUSES = [
  "open",
  "stop_pending",
  "approved",
  "cancelling",
  "closed",
  "kept",
  "failed",
] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

/** One tracked trial. Terms-derived fields are null until the terms lookup finishes. */
export interface Position {
  id: string;
  service_name: string;
  service_domain: string;
  signup_email: string;
  opened_at: IsoTimestamp;
  renewal_date: IsoDate | null;
  renewal_price_cents: number | null;
  currency: string | null;
  cancel_url: string | null;
  status: PositionStatus;
  /** Id of the email that proves the position closed. Null until then. */
  evidence_email_id: string | null;
}

export interface Event {
  id: string;
  position_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: IsoTimestamp;
}

export type ApprovalKind = "cancel" | "retention_offer";
export type ApprovalStatus = "pending" | "approved" | "declined";

export interface ApprovalRequest {
  id: string;
  position_id: string;
  kind: ApprovalKind;
  detail: string;
  status: ApprovalStatus;
  /** Null while the request is pending. */
  resolved_at: IsoTimestamp | null;
}

/** Output of the terms lookup (src/terms). */
export interface Terms {
  trial_days: number;
  renewal_price_cents: number;
  currency: string;
  cancel_policy: string;
  cancel_url: string;
  source_urls: string[];
}

export type CancelOutcome =
  | "cancelled"
  | "retention_offer"
  | "needs_login"
  | "failed";

/** Output of the cancel flow (src/cancel). */
export interface CancelResult {
  outcome: CancelOutcome;
  detail: string;
  live_view_url: string | null;
  replay_url: string | null;
}

/** Positions that count toward exposure: the sum of their renewal_price_cents. */
export const EXPOSED_STATUSES: readonly PositionStatus[] = [
  "open",
  "stop_pending",
];
