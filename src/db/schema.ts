import { POSITION_STATUSES } from "../types.js";
import { ACTIVE_STATUSES } from "./transitions.js";

// The schema, as an ordered list of idempotent statements. One statement per entry because the
// Neon HTTP driver runs a single statement per request. Run with `npm run db:migrate`.
//
// Status lists are generated from src/types.ts and src/db/transitions.ts, so the CHECK
// constraints and the TypeScript types cannot disagree.
//
// Design notes (the interview-worthy parts):
//  - Partial unique indexes carry the invariants: one LIVE position per (service, signup
//    address), and one PENDING approval per (position, kind). Races are settled by the database,
//    not by "check then insert" in application code.
//  - inbox_events is the raw ingest log, keyed by dedupe_key. A retried webhook hits the primary
//    key and becomes a no-op. events is the per-position timeline. They are separate because
//    an email can arrive before (or without) any position, and Event.position_id is required.
//  - Money is integer cents. Timestamps are timestamptz. No passwords, card numbers or email
//    bodies are stored anywhere.

const sqlList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

const LIVE = sqlList(ACTIVE_STATUSES);

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS positions (
    id text PRIMARY KEY,
    service_name text NOT NULL,
    service_domain text NOT NULL,
    signup_email text NOT NULL,
    opened_at timestamptz NOT NULL,
    renewal_date date,
    renewal_price_cents integer CHECK (renewal_price_cents IS NULL OR renewal_price_cents >= 0),
    currency text,
    cancel_url text,
    status text NOT NULL CHECK (status IN (${sqlList(POSITION_STATUSES)})),
    evidence_email_id text,
    CHECK (status <> 'closed' OR evidence_email_id IS NOT NULL)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS positions_one_live_per_service
    ON positions (service_domain, signup_email)
    WHERE status IN (${LIVE})`,
  `CREATE INDEX IF NOT EXISTS positions_status_renewal ON positions (status, renewal_date)`,

  `CREATE TABLE IF NOT EXISTS events (
    seq bigint GENERATED ALWAYS AS IDENTITY,
    id text PRIMARY KEY,
    position_id text NOT NULL REFERENCES positions (id),
    type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_position_seq ON events (position_id, seq)`,

  `CREATE TABLE IF NOT EXISTS inbox_events (
    dedupe_key text PRIMARY KEY,
    type text NOT NULL,
    position_id text REFERENCES positions (id),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    received_at timestamptz NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS approval_requests (
    id text PRIMARY KEY,
    position_id text NOT NULL REFERENCES positions (id),
    kind text NOT NULL CHECK (kind IN ('cancel', 'retention_offer')),
    detail text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'approved', 'declined')),
    created_at timestamptz NOT NULL,
    resolved_at timestamptz,
    CHECK ((status = 'pending') = (resolved_at IS NULL))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_per_kind
    ON approval_requests (position_id, kind)
    WHERE status = 'pending'`,
];
