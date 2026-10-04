// Shared types for every StopLoss module. Change this file only in its own small PR (skill section 6).
// Field names match the database columns in src/db/schema.sql.

export type PositionStatus =
  | "open"
  | "stop_pending"
  | "approved"
  | "cancelling"
  | "closed"
  | "kept"
  | "failed";

export type PositionSource = "email" | "signup_run" | "manual";

export type Position = {
  id: string;
  service_name: string;
  service_domain: string;
  product_blurb: string | null;
  plan_name: string | null;
  signup_email: string;
  opened_at: string;
  trial_days: number | null;
  renewal_date: string | null;
  stop_at: string | null;
  renewal_price_cents: number | null;
  currency: string;
  billing_period: string | null;
  cancel_url: string | null;
  cancel_policy: string | null;
  source_urls: string[];
  status: PositionStatus;
  status_reason: string | null;
  card_last4: string | null;
  created_by: PositionSource;
  evidence_email_id: string | null;
  closed_at: string | null;
};

export type EventType =
  | "email_received"
  | "position_opened"
  | "terms_found"
  | "stop_set"
  | "stop_pending"
  | "approval_requested"
  | "approval_resolved"
  | "run_started"
  | "run_step"
  | "run_finished"
  | "proof_received"
  | "position_closed"
  | "position_kept"
  | "position_failed";

export type PositionEvent = {
  id: string;
  position_id: string | null;
  type: EventType;
  title: string;
  detail: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ApprovalKind = "cancel" | "retention_offer";
export type ApprovalStatus = "pending" | "approved" | "declined";
export type ApprovalDecision = "approve" | "decline";

export type ApprovalRequest = {
  id: string;
  position_id: string;
  kind: ApprovalKind;
  detail: string | null;
  status: ApprovalStatus;
  workflow_run_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type Terms = {
  trial_days: number | null;
  renewal_price_cents: number | null;
  currency: string;
  billing_period: string | null;
  plan_name: string | null;
  cancel_policy: string | null;
  cancel_url: string | null;
  source_urls: string[];
};

export type CancelOutcome = "cancelled" | "retention_offer" | "needs_login" | "failed";

export type CancelResult = {
  outcome: CancelOutcome;
  detail: string;
  live_view_url: string | null;
  replay_url: string | null;
};

export type RunKind = "cancel" | "signup";
export type RunStatus = "running" | "succeeded" | "failed" | "paused";
export type RunStepStatus = "done" | "active" | "pending" | "failed";

export type RunStep = {
  key: string;
  title: string;
  detail: string;
  status: RunStepStatus;
  at: string | null;
};

export type AgentRun = {
  id: string;
  position_id: string | null;
  kind: RunKind;
  status: RunStatus;
  service_name: string;
  target_url: string | null;
  live_view_url: string | null;
  replay_url: string | null;
  browser_session_id: string | null;
  steps: RunStep[];
  error: string | null;
  started_at: string;
  invoked_at: string;
  finished_at: string | null;
};

export type EmailCategory =
  | "welcome"
  | "receipt"
  | "login_code"
  | "trial_ending"
  | "cancellation"
  | "account_setup"
  | "other";

// What StopLoss did with an inbound email. Shown as the badge in the Inbox.
export type EmailAction =
  | "position_created"
  | "terms_updated"
  | "stop_triggered"
  | "proof_received"
  | "login_code"
  | "ignored";

export type InboxEmail = {
  message_id: string;
  thread_id: string | null;
  inbox_id: string;
  from_address: string;
  from_name: string | null;
  subject: string;
  preview: string;
  received_at: string;
  category: EmailCategory;
  action: EmailAction;
  position_id: string | null;
  extracted: Partial<Terms> & { service_name?: string; service_domain?: string; renewal_date?: string };
};

export type PositionStats = {
  exposure_cents: number;
  active_trials: number;
  action_needed: number;
  avoided_cents: number;
};
