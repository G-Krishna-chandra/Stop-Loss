-- StopLoss schema. Apply with `npm run db:migrate`. Safe to run more than once.

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  service_name text not null,
  service_domain text not null,
  product_blurb text,
  plan_name text,
  signup_email text not null,
  opened_at timestamptz not null default now(),
  trial_days int,
  renewal_date timestamptz,
  stop_at timestamptz,
  renewal_price_cents int,
  currency text not null default 'USD',
  billing_period text,
  cancel_url text,
  cancel_policy text,
  source_urls text[] not null default '{}',
  status text not null default 'open'
    check (status in ('open', 'stop_pending', 'approved', 'cancelling', 'closed', 'kept', 'failed')),
  status_reason text,
  card_last4 text,
  created_by text not null default 'email' check (created_by in ('email', 'signup_run', 'manual')),
  evidence_email_id text,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Whether the service has a free trial at all (false = free plan only, nothing renews), and when terms were read.
alter table positions add column if not exists has_trial boolean;
alter table positions add column if not exists terms_checked_at timestamptz;

-- One live position per service. Closed, kept, and failed positions do not block a new one.
create unique index if not exists positions_one_live_per_domain
  on positions (service_domain)
  where status in ('open', 'stop_pending', 'approved', 'cancelling');

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  position_id uuid references positions (id) on delete cascade,
  type text not null,
  title text not null,
  detail text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists events_position_idx on events (position_id, created_at);

create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions (id) on delete cascade,
  kind text not null check (kind in ('cancel', 'retention_offer')),
  detail text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  workflow_run_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
-- At most one pending request of each kind per position.
create unique index if not exists approvals_one_pending
  on approval_requests (position_id, kind)
  where status = 'pending';

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  position_id uuid references positions (id) on delete cascade,
  kind text not null check (kind in ('cancel', 'signup')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'paused')),
  service_name text not null,
  target_url text,
  live_view_url text,
  replay_url text,
  browser_session_id text,
  steps jsonb not null default '[]',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
-- When the current attempt began. A Vercel function stops after maxDuration, so a run still "running" long after
-- this is treated as interrupted and paused for the user to continue.
alter table agent_runs add column if not exists invoked_at timestamptz not null default now();
-- Link single-use card approval for a sign-up run: where the user approves, and what to tell them.
alter table agent_runs add column if not exists card_action_url text;
alter table agent_runs add column if not exists card_note text;

-- Runs are history: deleting a position keeps its runs and only clears the link.
alter table agent_runs drop constraint if exists agent_runs_position_id_fkey;
alter table agent_runs add constraint agent_runs_position_id_fkey
  foreign key (position_id) references positions (id) on delete set null;

-- Our record of each AgentMail message: how it was classified and what StopLoss did with it.
-- Bodies stay in AgentMail and are fetched on demand.
create table if not exists emails (
  message_id text primary key,
  thread_id text,
  inbox_id text not null,
  from_address text not null,
  from_name text,
  subject text not null default '',
  preview text not null default '',
  received_at timestamptz not null,
  category text not null default 'other',
  action text not null default 'ignored',
  position_id uuid references positions (id) on delete set null,
  extracted jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists emails_received_idx on emails (received_at desc);
