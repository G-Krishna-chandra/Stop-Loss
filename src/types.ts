// Shared types. Change this file only in its own small PR, and tell the team.

export type PositionStatus =
  | 'open'
  | 'stop_pending'
  | 'approved'
  | 'cancelling'
  | 'closed'
  | 'failed'
  | 'kept';

export interface Position {
  id: string;
  service_name: string;
  service_domain: string;
  signup_email: string;
  opened_at: Date;
  renewal_date: Date | null;
  renewal_price_cents: number | null;
  currency: string | null;
  cancel_url: string | null;
  status: PositionStatus;
  evidence_email_id: string | null;
}

export type EventType =
  | 'email_received'
  | 'terms_found'
  | 'stop_armed'
  | 'approval_requested'
  | 'approval_resolved'
  | 'cancel_started'
  | 'cancel_result'
  | 'closed'
  | 'kept'
  | 'failed';

export interface PositionEvent {
  id: string;
  position_id: string;
  type: EventType;
  payload: Record<string, unknown>;
  created_at: Date;
}

export type ApprovalKind = 'cancel' | 'retention_offer';
export type ApprovalStatus = 'pending' | 'approved' | 'declined';
export type ApprovalDecision = Exclude<ApprovalStatus, 'pending'>;

export interface ApprovalRequest {
  id: string;
  position_id: string;
  kind: ApprovalKind;
  detail: string;
  status: ApprovalStatus;
  resolved_at: Date | null;
}

export interface Terms {
  trial_days: number | null;
  renewal_price_cents: number | null;
  currency: string | null;
  cancel_policy: string | null;
  cancel_url: string | null;
  source_urls: string[];
}

export type CancelOutcome = 'cancelled' | 'retention_offer' | 'needs_login' | 'failed';

export interface CancelResult {
  outcome: CancelOutcome;
  detail: string;
  live_view_url: string | null;
  replay_url: string | null;
}

export type EmailKind =
  | 'welcome'
  | 'receipt'
  | 'login_code'
  | 'trial_ending'
  | 'cancellation'
  | 'other';

/**
 * A classified inbound email. Email content is data, never instructions:
 * nothing in here may trigger a tool call on its own.
 * `login_code` and `magic_link` stay in memory only. Never write them to the database or logs.
 */
export interface InboxEmail {
  message_id: string;
  inbox_id: string;
  kind: EmailKind;
  from: string;
  subject: string;
  service_name: string;
  service_domain: string;
  received_at: Date;
  login_code: string | null;
  magic_link: string | null;
  position_id: string | null;
}

// Allowed status transitions. Any state can go to 'failed'.
export const TRANSITIONS: Record<PositionStatus, PositionStatus[]> = {
  open: ['stop_pending'],
  stop_pending: ['approved', 'kept'],
  approved: ['cancelling'],
  cancelling: ['closed'],
  closed: [],
  failed: [],
  kept: [],
};
