import type { IngestEvent } from "./contract.js";

// Pure helpers shared by every backend, so the in-memory and Postgres versions cannot drift on
// what an email means. The payload is untrusted, so every field is read defensively.

export interface IngestFacts {
  /** "welcome", "cancellation", ... from the event type "email.<kind>". Null if not an email. */
  kind: string | null;
  sender_domain: string | null;
  /**
   * The StopLoss address the trial was signed up with. Prefers the message's recipient address
   * and falls back to inbox_id, because AgentMail documents inbox_id as an opaque id, so the
   * fallback is only a best effort. Computed the same way for every email so matching is stable.
   */
  signup_email: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function readFacts(event: IngestEvent): IngestFacts {
  const payload = (typeof event.payload === "object" && event.payload !== null
    ? event.payload
    : {}) as Record<string, unknown>;
  const kind = event.type.startsWith("email.") ? event.type.slice("email.".length) : null;
  return {
    kind,
    sender_domain: text(payload["sender_domain"])?.toLowerCase() ?? null,
    signup_email:
      text(payload["recipient_address"])?.toLowerCase() ?? text(payload["inbox_id"]) ?? null,
  };
}

/**
 * Display name guess: "notion.so" -> "Notion". Deliberately dumb. src/terms can refine it with
 * the real product name once Exa has looked the service up.
 */
export function serviceNameFromDomain(domain: string): string {
  const first = domain.split(".")[0] ?? domain;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** renewal_date = opened_at + trial_days, as a UTC calendar date. */
export function addDaysUtc(openedAtIso: string, days: number): string {
  return new Date(new Date(openedAtIso).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
