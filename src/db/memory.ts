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
import { addDaysUtc, readFacts, serviceNameFromDomain } from "./ingest.js";
import {
  ACTIVE_STATUSES,
  allowedFrom,
  validateContext,
} from "./transitions.js";

// In-memory backend. Same behaviour as the Postgres one (the shared contract tests run both),
// so the rest of the app can be built and tested before a Neon database exists.

const EXPOSED: readonly PositionStatus[] = ["open", "stop_pending"];

export function createMemoryDb(options: DbOptions = {}): Db {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());

  const positions = new Map<string, Position>();
  const events: Event[] = [];
  const inbox = new Map<string, { position_id: string | null }>();
  const approvals = new Map<string, ApprovalRequest>();

  const iso = () => now().toISOString();
  const clone = <T>(value: T): T => structuredClone(value);

  function addEvent(position_id: string, type: string, payload: object): Event {
    const event: Event = {
      id: newId(),
      position_id,
      type,
      payload: clone(payload) as Record<string, unknown>,
      created_at: iso(),
    };
    events.push(event);
    return event;
  }

  function findActive(domain: string, email: string): Position | undefined {
    for (const p of positions.values()) {
      if (
        p.service_domain === domain &&
        p.signup_email === email &&
        ACTIVE_STATUSES.includes(p.status)
      ) {
        return p;
      }
    }
    return undefined;
  }

  function requirePosition(id: string): Position {
    const p = positions.get(id);
    if (!p) throw new PositionNotFoundError(id);
    return p;
  }

  return {
    async emit(event) {
      const seen = inbox.get(event.dedupe_key);
      if (seen) return { duplicate: true, position_id: seen.position_id };

      const facts = readFacts(event);
      let position_id: string | null = null;
      if (facts.sender_domain && facts.signup_email) {
        let position = findActive(facts.sender_domain, facts.signup_email);
        if (!position && facts.kind === "welcome") {
          position = {
            id: newId(),
            service_name: serviceNameFromDomain(facts.sender_domain),
            service_domain: facts.sender_domain,
            signup_email: facts.signup_email,
            opened_at: iso(),
            renewal_date: null,
            renewal_price_cents: null,
            currency: null,
            cancel_url: null,
            status: "open",
            evidence_email_id: null,
          };
          positions.set(position.id, position);
          addEvent(position.id, "position.opened", { dedupe_key: event.dedupe_key });
        }
        position_id = position?.id ?? null;
      }

      inbox.set(event.dedupe_key, { position_id });
      if (position_id) addEvent(position_id, event.type, event.payload);
      return { duplicate: false, position_id };
    },

    async getPosition(id) {
      const p = positions.get(id);
      return p ? clone(p) : null;
    },

    async listPositions(filter) {
      const wanted = filter?.status;
      return [...positions.values()]
        .filter((p) => !wanted || wanted.includes(p.status))
        .sort((a, b) => b.opened_at.localeCompare(a.opened_at) || a.id.localeCompare(b.id))
        .map(clone);
    },

    async findActivePosition(service_domain, signup_email) {
      const p = findActive(service_domain.toLowerCase(), signup_email.toLowerCase());
      return p ? clone(p) : null;
    },

    async setTerms(position_id, terms) {
      const p = requirePosition(position_id);
      if (p.status !== "open" && p.status !== "stop_pending") {
        throw new PositionNotEditableError(position_id, p.status);
      }
      p.renewal_price_cents = terms.renewal_price_cents;
      p.currency = terms.currency;
      p.cancel_url = terms.cancel_url;
      p.renewal_date = addDaysUtc(p.opened_at, terms.trial_days);
      addEvent(position_id, "terms.set", terms as unknown as object);
      return clone(p);
    },

    async transitionPosition(position_id, to, ctx = {}) {
      validateContext(to, ctx);
      const p = requirePosition(position_id);
      if (!allowedFrom(to).includes(p.status)) {
        throw new InvalidTransitionError(position_id, p.status, to);
      }
      const from = p.status;
      p.status = to;
      if (ctx.evidence_email_id) p.evidence_email_id = ctx.evidence_email_id;
      addEvent(position_id, "status.changed", {
        from,
        to,
        reason: ctx.reason ?? null,
        evidence_email_id: ctx.evidence_email_id ?? null,
      });
      return clone(p);
    },

    async appendEvent(position_id, type, payload) {
      requirePosition(position_id);
      return clone(addEvent(position_id, type, payload));
    },

    async listEvents(position_id) {
      return events.filter((e) => e.position_id === position_id).map(clone);
    },

    async createApproval(input) {
      requirePosition(input.position_id);
      for (const a of approvals.values()) {
        if (
          a.position_id === input.position_id &&
          a.kind === input.kind &&
          a.status === "pending"
        ) {
          return clone(a);
        }
      }
      const approval: ApprovalRequest = {
        id: newId(),
        position_id: input.position_id,
        kind: input.kind,
        detail: input.detail,
        status: "pending",
        resolved_at: null,
      };
      approvals.set(approval.id, approval);
      addEvent(input.position_id, "approval.requested", {
        approval_id: approval.id,
        kind: approval.kind,
      });
      return clone(approval);
    },

    async getApproval(id) {
      const a = approvals.get(id);
      return a ? clone(a) : null;
    },

    async resolveApproval(id, decision) {
      const a = approvals.get(id);
      if (!a) throw new ApprovalNotFoundError(id);
      if (a.status !== "pending") {
        if (a.status === decision) return clone(a);
        throw new ApprovalAlreadyResolvedError(id, a.status);
      }
      a.status = decision;
      a.resolved_at = iso();
      addEvent(a.position_id, "approval.resolved", {
        approval_id: a.id,
        kind: a.kind,
        decision,
      });
      return clone(a);
    },

    async getExposure() {
      const exposure: Exposure = { by_currency: {}, unknown_price_count: 0 };
      for (const p of positions.values()) {
        if (!EXPOSED.includes(p.status)) continue;
        if (p.renewal_price_cents === null || p.currency === null) {
          exposure.unknown_price_count += 1;
        } else {
          exposure.by_currency[p.currency] =
            (exposure.by_currency[p.currency] ?? 0) + p.renewal_price_cents;
        }
      }
      return exposure;
    },

    async listDueForStop({ today, within_days }) {
      const limit = addDaysUtc(`${today}T00:00:00.000Z`, within_days);
      return [...positions.values()]
        .filter((p) => p.status === "open" && p.renewal_date !== null && p.renewal_date <= limit)
        .sort((a, b) => (a.renewal_date ?? "").localeCompare(b.renewal_date ?? "") || a.id.localeCompare(b.id))
        .map(clone);
    },
  };
}
