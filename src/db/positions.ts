import type { Position, PositionSource, PositionStats, PositionStatus, Terms } from "@/types";
import { iso, sql } from "./client";

type Row = Record<string, unknown>;

const LIVE: PositionStatus[] = ["open", "stop_pending", "approved", "cancelling"];

function toPosition(r: Row): Position {
  return {
    id: String(r.id),
    service_name: String(r.service_name),
    service_domain: String(r.service_domain),
    product_blurb: (r.product_blurb as string | null) ?? null,
    plan_name: (r.plan_name as string | null) ?? null,
    signup_email: String(r.signup_email),
    opened_at: iso(r.opened_at) ?? "",
    trial_days: (r.trial_days as number | null) ?? null,
    renewal_date: iso(r.renewal_date),
    stop_at: iso(r.stop_at),
    renewal_price_cents: (r.renewal_price_cents as number | null) ?? null,
    currency: String(r.currency ?? "USD"),
    billing_period: (r.billing_period as string | null) ?? null,
    cancel_url: (r.cancel_url as string | null) ?? null,
    cancel_policy: (r.cancel_policy as string | null) ?? null,
    source_urls: (r.source_urls as string[] | null) ?? [],
    has_trial: (r.has_trial as boolean | null) ?? null,
    terms_checked_at: iso(r.terms_checked_at),
    status: r.status as PositionStatus,
    status_reason: (r.status_reason as string | null) ?? null,
    card_last4: (r.card_last4 as string | null) ?? null,
    created_by: r.created_by as PositionSource,
    evidence_email_id: (r.evidence_email_id as string | null) ?? null,
    closed_at: iso(r.closed_at),
  };
}

export async function listPositions(): Promise<Position[]> {
  const rows = await sql()`
    select * from positions
    order by
      case status
        when 'stop_pending' then 0
        when 'approved' then 1
        when 'cancelling' then 1
        when 'failed' then 2
        when 'open' then 3
        else 4
      end,
      coalesce(renewal_date, opened_at) asc`;
  return rows.map(toPosition);
}

export async function getPosition(id: string): Promise<Position | null> {
  const rows = await sql()`select * from positions where id = ${id}`;
  return rows[0] ? toPosition(rows[0]) : null;
}

export async function findLivePositionByDomain(domain: string): Promise<Position | null> {
  const rows = await sql()`
    select * from positions where service_domain = ${domain} and status = any(${LIVE}) limit 1`;
  return rows[0] ? toPosition(rows[0]) : null;
}

export type NewPosition = {
  service_name: string;
  service_domain: string;
  signup_email: string;
  product_blurb?: string | null;
  created_by: PositionSource;
  evidence_email_id?: string | null;
  card_last4?: string | null;
  opened_at?: string;
};

// Opens a position, or returns the live one that already exists for this domain.
export async function openPosition(p: NewPosition): Promise<{ position: Position; created: boolean }> {
  const rows = await sql()`
    insert into positions (service_name, service_domain, signup_email, product_blurb, created_by, evidence_email_id, card_last4, opened_at)
    values (${p.service_name}, ${p.service_domain}, ${p.signup_email}, ${p.product_blurb ?? null}, ${p.created_by},
            ${p.evidence_email_id ?? null}, ${p.card_last4 ?? null}, ${p.opened_at ?? new Date().toISOString()})
    on conflict (service_domain) where status in ('open', 'stop_pending', 'approved', 'cancelling') do nothing
    returning *`;
  if (rows[0]) return { position: toPosition(rows[0]), created: true };
  const existing = await findLivePositionByDomain(p.service_domain);
  if (!existing) throw new Error(`Could not open or find a position for ${p.service_domain}`);
  return { position: existing, created: false };
}

// Stores the terms and derives the renewal date and the stop. The stop is STOP_LEAD_HOURS before renewal (default 24).
export async function applyTerms(id: string, terms: Terms): Promise<Position> {
  const leadHours = Number(process.env.STOP_LEAD_HOURS ?? 24);
  const rows = await sql()`
    update positions set
      trial_days = coalesce(${terms.trial_days}, trial_days),
      renewal_price_cents = coalesce(${terms.renewal_price_cents}, renewal_price_cents),
      currency = coalesce(${terms.currency}, currency),
      billing_period = coalesce(${terms.billing_period}, billing_period),
      plan_name = coalesce(${terms.plan_name}, plan_name),
      cancel_policy = coalesce(${terms.cancel_policy}, cancel_policy),
      cancel_url = coalesce(${terms.cancel_url}, cancel_url),
      source_urls = ${terms.source_urls},
      has_trial = coalesce(${terms.has_trial}, has_trial),
      terms_checked_at = now(),
      renewal_date = case
        when coalesce(${terms.trial_days}, trial_days) is null then renewal_date
        else opened_at + make_interval(days => coalesce(${terms.trial_days}, trial_days))
      end,
      updated_at = now()
    where id = ${id}
    returning *`;
  const updated = await sql()`
    update positions set
      stop_at = case when renewal_date is null then null
                     else greatest(opened_at, renewal_date - make_interval(hours => ${leadHours})) end
    where id = ${id}
    returning *`;
  if (!rows[0] || !updated[0]) throw new Error(`Position ${id} not found`);
  return toPosition(updated[0]);
}

// Moves a position only if it is currently in one of `from`. Returns null when the move did not apply.
export async function transition(
  id: string,
  from: PositionStatus[],
  to: PositionStatus,
  reason: string | null = null,
): Promise<Position | null> {
  const rows = await sql()`
    update positions set
      status = ${to},
      status_reason = ${reason},
      closed_at = case when ${to} in ('closed', 'kept') then now() else closed_at end,
      updated_at = now()
    where id = ${id} and status = any(${from})
    returning *`;
  return rows[0] ? toPosition(rows[0]) : null;
}

export async function setEvidence(id: string, emailId: string): Promise<void> {
  await sql()`update positions set evidence_email_id = ${emailId}, updated_at = now() where id = ${id}`;
}

export async function dueStops(now = new Date()): Promise<Position[]> {
  const rows = await sql()`
    select * from positions where status = 'open' and stop_at is not null and stop_at <= ${now.toISOString()}`;
  return rows.map(toPosition);
}

export async function getStats(): Promise<PositionStats> {
  const rows = await sql()`
    select
      coalesce(sum(renewal_price_cents) filter (
        where status in ('open', 'stop_pending') and renewal_date is not null and has_trial is not false), 0)::int as exposure_cents,
      count(*) filter (where status in ('open', 'stop_pending', 'approved', 'cancelling') and has_trial is not false)::int as active_trials,
      count(*) filter (where status in ('stop_pending', 'failed'))::int as action_needed,
      coalesce(sum(renewal_price_cents) filter (where status = 'closed'), 0)::int as avoided_cents
    from positions`;
  const r = rows[0] ?? {};
  return {
    exposure_cents: Number(r.exposure_cents ?? 0),
    active_trials: Number(r.active_trials ?? 0),
    action_needed: Number(r.action_needed ?? 0),
    avoided_cents: Number(r.avoided_cents ?? 0),
  };
}
