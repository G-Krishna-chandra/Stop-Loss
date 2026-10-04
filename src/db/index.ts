// The only module that touches SQL.
import { sql } from './client.js';
import {
  TRANSITIONS,
  type ApprovalDecision,
  type ApprovalKind,
  type ApprovalRequest,
  type EventType,
  type Position,
  type PositionEvent,
  type PositionStatus,
} from '../types.js';

// ---------- positions ----------

export interface NewPosition {
  service_name: string;
  service_domain: string;
  signup_email: string;
}

/** Creates a position, or returns the existing active one for this service and address. */
export async function openPosition(p: NewPosition): Promise<{ position: Position; created: boolean }> {
  const inserted = (await sql()`
    INSERT INTO positions (service_name, service_domain, signup_email)
    VALUES (${p.service_name}, ${p.service_domain.toLowerCase()}, ${p.signup_email.toLowerCase()})
    ON CONFLICT (service_domain, signup_email) WHERE status NOT IN ('closed','failed','kept')
    DO NOTHING
    RETURNING *`) as Position[];
  if (inserted[0]) return { position: inserted[0], created: true };

  const existing = (await sql()`
    SELECT * FROM positions
    WHERE service_domain = ${p.service_domain.toLowerCase()}
      AND signup_email = ${p.signup_email.toLowerCase()}
      AND status NOT IN ('closed','failed','kept')
    LIMIT 1`) as Position[];
  return { position: existing[0]!, created: false };
}

/** A position for this service opened in the last 30 days, in any status. Services send several "welcome" emails. */
export async function recentPosition(domain: string, signupEmail: string): Promise<Position | null> {
  const rows = (await sql()`
    SELECT * FROM positions
    WHERE service_domain = ${domain.toLowerCase()} AND signup_email = ${signupEmail.toLowerCase()}
      AND opened_at > now() - interval '30 days'
    ORDER BY opened_at DESC LIMIT 1`) as Position[];
  return rows[0] ?? null;
}

export async function getPosition(id: string): Promise<Position | null> {
  const rows = (await sql()`SELECT * FROM positions WHERE id = ${id}`) as Position[];
  return rows[0] ?? null;
}

export async function findActivePositionByDomain(domain: string): Promise<Position | null> {
  const rows = (await sql()`
    SELECT * FROM positions
    WHERE service_domain = ${domain.toLowerCase()} AND status NOT IN ('closed','failed','kept')
    ORDER BY opened_at DESC LIMIT 1`) as Position[];
  return rows[0] ?? null;
}

export async function listPositions(): Promise<Position[]> {
  return (await sql()`SELECT * FROM positions ORDER BY opened_at DESC`) as Position[];
}

export interface TermsUpdate {
  renewal_date: Date | null;
  renewal_price_cents: number | null;
  currency: string | null;
  cancel_url: string | null;
}

export async function applyTerms(id: string, t: TermsUpdate): Promise<Position | null> {
  const rows = (await sql()`
    UPDATE positions SET
      renewal_date = COALESCE(${t.renewal_date}, renewal_date),
      renewal_price_cents = COALESCE(${t.renewal_price_cents}, renewal_price_cents),
      currency = COALESCE(${t.currency}, currency),
      cancel_url = COALESCE(${t.cancel_url}, cancel_url)
    WHERE id = ${id}
    RETURNING *`) as Position[];
  return rows[0] ?? null;
}

/**
 * Moves a position to `to` only if the transition is allowed from its current status.
 * Atomic: two callers racing for the same transition cannot both win.
 * Returns the updated position, or null if the transition was not allowed.
 */
export async function transition(
  id: string,
  to: PositionStatus,
  extra: { evidence_email_id?: string } = {},
): Promise<Position | null> {
  const from = (Object.keys(TRANSITIONS) as PositionStatus[]).filter(
    (s) => to === 'failed' ? !['closed', 'failed', 'kept'].includes(s) : TRANSITIONS[s].includes(to),
  );
  if (from.length === 0) return null;
  const rows = (await sql()`
    UPDATE positions SET
      status = ${to},
      evidence_email_id = COALESCE(${extra.evidence_email_id ?? null}, evidence_email_id)
    WHERE id = ${id} AND status = ANY(${from})
    RETURNING *`) as Position[];
  return rows[0] ?? null;
}

/** Open positions whose stop time has arrived: renewal is within `leadHours`. */
export async function dueForStop(leadHours: number): Promise<Position[]> {
  return (await sql()`
    SELECT * FROM positions
    WHERE status = 'open'
      AND renewal_date IS NOT NULL
      AND renewal_date <= now() + make_interval(hours => ${leadHours})
    ORDER BY renewal_date`) as Position[];
}

/** Demo control: move a position's renewal date so the stop check picks it up now. */
export async function fastForward(id: string, renewsInHours: number): Promise<Position | null> {
  const rows = (await sql()`
    UPDATE positions SET renewal_date = now() + make_interval(hours => ${renewsInHours})
    WHERE id = ${id} RETURNING *`) as Position[];
  return rows[0] ?? null;
}

/** Demo/dev only: put a finished position back to 'open' so its stop can run again. Recorded as an event. */
export async function reopen(id: string): Promise<Position | null> {
  const rows = (await sql()`
    UPDATE positions SET status = 'open', evidence_email_id = NULL
    WHERE id = ${id} AND status IN ('kept', 'failed')
    RETURNING *`) as Position[];
  if (rows[0]) await addEvent(id, 'email_received', { note: 'reopened by hand for a rerun' });
  return rows[0] ?? null;
}

/** Total renewal price at risk, per currency. */
export async function exposure(): Promise<{ currency: string; cents: number }[]> {
  const rows = (await sql()`
    SELECT COALESCE(currency, 'USD') AS currency, COALESCE(SUM(renewal_price_cents), 0)::int AS cents
    FROM positions WHERE status IN ('open','stop_pending')
    GROUP BY 1`) as { currency: string; cents: number }[];
  return rows;
}

// ---------- events ----------

export async function addEvent(
  position_id: string,
  type: EventType,
  payload: Record<string, unknown> = {},
): Promise<PositionEvent> {
  const rows = (await sql()`
    INSERT INTO events (position_id, type, payload)
    VALUES (${position_id}, ${type}, ${JSON.stringify(payload)}::jsonb)
    RETURNING *`) as PositionEvent[];
  return rows[0]!;
}

export async function listEvents(position_id: string): Promise<PositionEvent[]> {
  return (await sql()`
    SELECT * FROM events WHERE position_id = ${position_id} ORDER BY created_at`) as PositionEvent[];
}

/** Marks a position failed and records why. Never call this to hide an uncertain cancel; it surfaces it. */
export async function fail(position_id: string, reason: string): Promise<Position | null> {
  const p = await transition(position_id, 'failed');
  if (p) await addEvent(position_id, 'failed', { reason });
  return p;
}

// ---------- approvals ----------

export async function createApproval(
  position_id: string,
  kind: ApprovalKind,
  detail: string,
): Promise<ApprovalRequest> {
  const inserted = (await sql()`
    INSERT INTO approval_requests (position_id, kind, detail)
    VALUES (${position_id}, ${kind}, ${detail})
    ON CONFLICT (position_id, kind) WHERE status = 'pending' DO NOTHING
    RETURNING *`) as ApprovalRequest[];
  if (inserted[0]) return inserted[0];
  const existing = (await sql()`
    SELECT * FROM approval_requests
    WHERE position_id = ${position_id} AND kind = ${kind} AND status = 'pending'`) as ApprovalRequest[];
  return existing[0]!;
}

export async function getApproval(id: string): Promise<ApprovalRequest | null> {
  const rows = (await sql()`SELECT * FROM approval_requests WHERE id = ${id}`) as ApprovalRequest[];
  return rows[0] ?? null;
}

/** Resolves a pending approval exactly once. Returns null if it was missing or already resolved. */
export async function resolveApprovalRow(
  id: string,
  decision: ApprovalDecision,
): Promise<ApprovalRequest | null> {
  const rows = (await sql()`
    UPDATE approval_requests SET status = ${decision}, resolved_at = now()
    WHERE id = ${id} AND status = 'pending'
    RETURNING *`) as ApprovalRequest[];
  return rows[0] ?? null;
}

export async function listPendingApprovals(): Promise<ApprovalRequest[]> {
  return (await sql()`
    SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY created_at`) as ApprovalRequest[];
}
