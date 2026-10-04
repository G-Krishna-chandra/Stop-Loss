import { randomUUID } from "node:crypto";
import type {
  ApprovalRequest,
  Event,
  Position,
  PositionStatus,
} from "../types.js";
import type { Db, DbOptions, Exposure } from "./contract.js";
import {
  ApprovalAlreadyResolvedError,
  ApprovalNotFoundError,
  InvalidTransitionError,
  PositionNotEditableError,
  PositionNotFoundError,
} from "./errors.js";
import { readFacts, serviceNameFromDomain } from "./ingest.js";
import { SCHEMA_STATEMENTS } from "./schema.js";
import { ACTIVE_STATUSES, allowedFrom, validateContext } from "./transitions.js";

// Postgres backend. It only needs a function that runs one parameterized statement and returns
// rows, so the same code runs on Neon in production (src/db/neon.ts) and on an in-process real
// Postgres (PGlite) in tests.
//
// Concurrency model: the Neon HTTP driver has no interactive transactions, so every operation
// that must be atomic is ONE statement (compare-and-set UPDATEs, data-modifying CTEs). The
// database decides races through unique indexes and WHERE-clause status checks.

export type Row = Record<string, unknown>;
export type SqlRunner = (text: string, params?: unknown[]) => Promise<Row[]>;

const LIVE_SQL = ACTIVE_STATUSES.map((s) => `'${s}'`).join(", ");

// Dates and timestamps are normalized in one place. DATE columns are cast to text in SQL so a
// driver never turns them into a Date in the server's local time zone.
const POSITION_COLS = `id, service_name, service_domain, signup_email, opened_at,
  renewal_date::text AS renewal_date, renewal_price_cents, currency, cancel_url, status,
  evidence_email_id`;
const APPROVAL_COLS = `id, position_id, kind, detail, status, resolved_at`;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const isoOf = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const json = (v: unknown): string => JSON.stringify(v ?? {});
const textArray = (values: readonly string[]): string => `{${values.join(",")}}`;

function toPosition(row: Row): Position {
  return {
    id: str(row["id"]),
    service_name: str(row["service_name"]),
    service_domain: str(row["service_domain"]),
    signup_email: str(row["signup_email"]),
    opened_at: isoOf(row["opened_at"]),
    renewal_date: strOrNull(row["renewal_date"]),
    renewal_price_cents: numOrNull(row["renewal_price_cents"]),
    currency: strOrNull(row["currency"]),
    cancel_url: strOrNull(row["cancel_url"]),
    status: str(row["status"]) as PositionStatus,
    evidence_email_id: strOrNull(row["evidence_email_id"]),
  };
}

function toEvent(row: Row): Event {
  const payload = row["payload"];
  return {
    id: str(row["id"]),
    position_id: str(row["position_id"]),
    type: str(row["type"]),
    payload: (typeof payload === "string" ? JSON.parse(payload) : payload) as Record<string, unknown>,
    created_at: isoOf(row["created_at"]),
  };
}

function toApproval(row: Row): ApprovalRequest {
  return {
    id: str(row["id"]),
    position_id: str(row["position_id"]),
    kind: str(row["kind"]) as ApprovalRequest["kind"],
    detail: str(row["detail"]),
    status: str(row["status"]) as ApprovalRequest["status"],
    resolved_at: row["resolved_at"] === null || row["resolved_at"] === undefined ? null : isoOf(row["resolved_at"]),
  };
}

/** Creates the tables and indexes. Safe to run repeatedly. */
export async function migrate(run: SqlRunner): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) await run(statement);
}

export function createPostgresDb(run: SqlRunner, options: DbOptions = {}): Db {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());
  const iso = () => now().toISOString();

  async function one(text: string, params: unknown[]): Promise<Row | null> {
    const rows = await run(text, params);
    return rows[0] ?? null;
  }

  async function getPosition(id: string): Promise<Position | null> {
    const row = await one(`SELECT ${POSITION_COLS} FROM positions WHERE id = $1`, [id]);
    return row ? toPosition(row) : null;
  }

  async function findActive(domain: string, email: string): Promise<Position | null> {
    const row = await one(
      `SELECT ${POSITION_COLS} FROM positions
       WHERE service_domain = $1 AND signup_email = $2 AND status IN (${LIVE_SQL})`,
      [domain, email],
    );
    return row ? toPosition(row) : null;
  }

  /**
   * Opens a position, or returns the live one that already exists. The partial unique index makes
   * this race-safe: of two simultaneous welcome emails, one inserts and the other conflicts.
   * The timeline row is written in the same statement, so a position never exists without it.
   */
  async function ensurePosition(domain: string, email: string, dedupeKey: string): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const created = await one(
        `WITH ins AS (
           INSERT INTO positions (id, service_name, service_domain, signup_email, opened_at, status)
           VALUES ($1, $2, $3, $4, $5::timestamptz, 'open')
           ON CONFLICT (service_domain, signup_email) WHERE status IN (${LIVE_SQL}) DO NOTHING
           RETURNING id
         ), ev AS (
           INSERT INTO events (id, position_id, type, payload, created_at)
           SELECT $6, id, 'position.opened', $7::jsonb, $5::timestamptz FROM ins
         )
         SELECT id FROM ins`,
        [newId(), serviceNameFromDomain(domain), domain, email, iso(), newId(), json({ dedupe_key: dedupeKey })],
      );
      if (created) return str(created["id"]);
      const existing = await findActive(domain, email);
      if (existing) return existing.id;
      // The live position closed between the conflict and the lookup. Try the insert once more.
    }
    return null;
  }

  async function requireApprovalRow(id: string): Promise<ApprovalRequest> {
    const row = await one(`SELECT ${APPROVAL_COLS} FROM approval_requests WHERE id = $1`, [id]);
    if (!row) throw new ApprovalNotFoundError(id);
    return toApproval(row);
  }

  return {
    async emit(event) {
      const already = await one(`SELECT position_id FROM inbox_events WHERE dedupe_key = $1`, [event.dedupe_key]);
      if (already) return { duplicate: true, position_id: strOrNull(already["position_id"]) };

      const facts = readFacts(event);
      let position_id: string | null = null;
      if (facts.sender_domain && facts.signup_email) {
        position_id =
          facts.kind === "welcome"
            ? await ensurePosition(facts.sender_domain, facts.signup_email, event.dedupe_key)
            : ((await findActive(facts.sender_domain, facts.signup_email))?.id ?? null);
      }

      // One statement records the ingest row and its timeline row together. The primary key on
      // dedupe_key settles two deliveries racing past the check above.
      const result = await one(
        `WITH ins AS (
           INSERT INTO inbox_events (dedupe_key, type, position_id, payload, received_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
           ON CONFLICT (dedupe_key) DO NOTHING
           RETURNING dedupe_key, position_id
         ), ev AS (
           INSERT INTO events (id, position_id, type, payload, created_at)
           SELECT $6, position_id, $2, $4::jsonb, $5::timestamptz FROM ins WHERE position_id IS NOT NULL
         )
         SELECT count(*)::int AS inserted FROM ins`,
        [event.dedupe_key, event.type, position_id, json(event.payload), iso(), newId()],
      );
      return { duplicate: Number(result?.["inserted"] ?? 0) === 0, position_id };
    },

    getPosition,

    async listPositions(filter) {
      const wanted = filter?.status;
      const rows = await run(
        `SELECT ${POSITION_COLS} FROM positions
         WHERE ($1::text[] IS NULL OR status = ANY($1::text[]))
         ORDER BY opened_at DESC, id`,
        [wanted ? textArray(wanted) : null],
      );
      return rows.map(toPosition);
    },

    async findActivePosition(service_domain, signup_email) {
      return findActive(service_domain.toLowerCase(), signup_email.toLowerCase());
    },

    async setTerms(position_id, terms) {
      const row = await one(
        `WITH upd AS (
           UPDATE positions
           SET renewal_price_cents = $2::int, currency = $3::text, cancel_url = $4::text,
               renewal_date = ((opened_at AT TIME ZONE 'UTC') + make_interval(days => $5::int))::date
           WHERE id = $1 AND status IN ('open', 'stop_pending')
           RETURNING ${POSITION_COLS}
         ), ev AS (
           INSERT INTO events (id, position_id, type, payload, created_at)
           SELECT $6, id, 'terms.set', $7::jsonb, $8::timestamptz FROM upd
         )
         SELECT * FROM upd`,
        [
          position_id,
          terms.renewal_price_cents,
          terms.currency,
          terms.cancel_url,
          terms.trial_days,
          newId(),
          json(terms),
          iso(),
        ],
      );
      if (row) return toPosition(row);
      const current = await getPosition(position_id);
      if (!current) throw new PositionNotFoundError(position_id);
      throw new PositionNotEditableError(position_id, current.status);
    },

    async transitionPosition(position_id, to, ctx = {}) {
      validateContext(to, ctx);
      // Compare-and-set: the UPDATE only matches when the current status may move to `to`.
      // FOR UPDATE on the subselect makes a concurrent caller wait, then re-check the status.
      const row = await one(
        `WITH moved AS (
           UPDATE positions p
           SET status = $2::text, evidence_email_id = COALESCE($4::text, p.evidence_email_id)
           FROM (SELECT id, status AS old_status FROM positions WHERE id = $1 FOR UPDATE) o
           WHERE p.id = o.id AND p.status = ANY($3::text[])
           RETURNING p.id, p.service_name, p.service_domain, p.signup_email, p.opened_at,
             p.renewal_date::text AS renewal_date, p.renewal_price_cents, p.currency,
             p.cancel_url, p.status, p.evidence_email_id, o.old_status
         ), ev AS (
           INSERT INTO events (id, position_id, type, payload, created_at)
           SELECT $5, id, 'status.changed',
             jsonb_build_object('from', old_status, 'to', $2::text, 'reason', $6::text,
                                'evidence_email_id', $4::text),
             $7::timestamptz
           FROM moved
         )
         SELECT * FROM moved`,
        [
          position_id,
          to,
          textArray(allowedFrom(to)),
          ctx.evidence_email_id ?? null,
          newId(),
          ctx.reason ?? null,
          iso(),
        ],
      );
      if (row) return toPosition(row);
      const current = await getPosition(position_id);
      if (!current) throw new PositionNotFoundError(position_id);
      throw new InvalidTransitionError(position_id, current.status, to);
    },

    async appendEvent(position_id, type, payload) {
      const row = await one(
        `INSERT INTO events (id, position_id, type, payload, created_at)
         SELECT $1, id, $3, $4::jsonb, $5::timestamptz FROM positions WHERE id = $2
         RETURNING id, position_id, type, payload, created_at`,
        [newId(), position_id, type, json(payload), iso()],
      );
      if (!row) throw new PositionNotFoundError(position_id);
      return toEvent(row);
    },

    async listEvents(position_id) {
      const rows = await run(
        `SELECT id, position_id, type, payload, created_at FROM events
         WHERE position_id = $1 ORDER BY seq`,
        [position_id],
      );
      return rows.map(toEvent);
    },

    async createApproval(input) {
      const created = await one(
        `WITH ins AS (
           INSERT INTO approval_requests (id, position_id, kind, detail, status, created_at)
           SELECT $1, id, $3::text, $4::text, 'pending', $5::timestamptz FROM positions WHERE id = $2
           ON CONFLICT (position_id, kind) WHERE status = 'pending' DO NOTHING
           RETURNING ${APPROVAL_COLS}
         ), ev AS (
           INSERT INTO events (id, position_id, type, payload, created_at)
           SELECT $6, position_id, 'approval.requested',
             jsonb_build_object('approval_id', id, 'kind', kind), $5::timestamptz
           FROM ins
         )
         SELECT * FROM ins`,
        [newId(), input.position_id, input.kind, input.detail, iso(), newId()],
      );
      if (created) return toApproval(created);
      const pending = await one(
        `SELECT ${APPROVAL_COLS} FROM approval_requests
         WHERE position_id = $1 AND kind = $2 AND status = 'pending'`,
        [input.position_id, input.kind],
      );
      if (pending) return toApproval(pending);
      throw new PositionNotFoundError(input.position_id);
    },

    async getApproval(id) {
      const row = await one(`SELECT ${APPROVAL_COLS} FROM approval_requests WHERE id = $1`, [id]);
      return row ? toApproval(row) : null;
    },

    async listApprovals(filter) {
      const rows = await run(
        `SELECT ${APPROVAL_COLS} FROM approval_requests
         WHERE ($1::text IS NULL OR status = $1::text)
         ORDER BY created_at, id`,
        [filter?.status ?? null],
      );
      return rows.map(toApproval);
    },

    async resolveApproval(id, decision) {
      const resolved = await one(
        `WITH res AS (
           UPDATE approval_requests SET status = $2::text, resolved_at = $3::timestamptz
           WHERE id = $1 AND status = 'pending'
           RETURNING ${APPROVAL_COLS}
         ), ev AS (
           INSERT INTO events (id, position_id, type, payload, created_at)
           SELECT $4, position_id, 'approval.resolved',
             jsonb_build_object('approval_id', id, 'kind', kind, 'decision', status),
             $3::timestamptz
           FROM res
         )
         SELECT * FROM res`,
        [id, decision, iso(), newId()],
      );
      if (resolved) return toApproval(resolved);
      const current = await requireApprovalRow(id);
      if (current.status === decision) return current;
      throw new ApprovalAlreadyResolvedError(id, current.status);
    },

    async getExposure() {
      const rows = await run(
        `SELECT currency, COALESCE(SUM(renewal_price_cents), 0)::bigint AS cents, COUNT(*)::bigint AS positions
         FROM positions
         WHERE status IN ('open', 'stop_pending')
         GROUP BY currency`,
      );
      const exposure: Exposure = { by_currency: {}, unknown_price_count: 0 };
      for (const row of rows) {
        const currency = strOrNull(row["currency"]);
        if (currency === null) {
          exposure.unknown_price_count += Number(row["positions"]);
        } else {
          exposure.by_currency[currency] = Number(row["cents"]);
        }
      }
      return exposure;
    },

    async listDueForStop({ today, within_days }) {
      const rows = await run(
        `SELECT ${POSITION_COLS} FROM positions
         WHERE status = 'open' AND renewal_date IS NOT NULL
           AND renewal_date <= ($1::date + $2::int)
         ORDER BY renewal_date, id`,
        [today, within_days],
      );
      return rows.map(toPosition);
    },
  };
}
