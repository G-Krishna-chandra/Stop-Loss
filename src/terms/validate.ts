import { z } from "zod";
import type { Terms } from "../types.js";

// Everything Exa returns is derived from open web pages, so it is untrusted DATA. It is never
// executed or followed as instructions. This file is the gate: only values that pass these checks
// become Terms. In particular cancel_url must live on the service's own domain (or a known billing
// portal), because src/cancel will open it in a logged-in browser. A poisoned page that returned
// "https://evil.example/cancel" must not get that far.

export const MAX_POLICY_CHARS = 600;
const MAX_TRIAL_DAYS = 365;
const MAX_PRICE_CENTS = 1_000_000; // $10,000: anything above is far more likely an extraction error

/** Hosted billing portals that legitimately serve cancel pages for many services. */
export const DEFAULT_BILLING_PORTAL_DOMAINS: readonly string[] = [
  "stripe.com",
  "paddle.com",
  "chargebee.com",
  "recurly.com",
  "fastspring.com",
];

/** The JSON schema sent to Exa. Price is asked for in major units so we do the cents maths. */
export const EXA_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    trial_days: {
      type: "integer",
      description: "Length of the free trial in days. Convert weeks or months to days.",
    },
    renewal_price: {
      type: "number",
      description: "Price charged per billing period right after the trial, in major currency units, e.g. 12.99.",
    },
    currency: { type: "string", description: "ISO 4217 currency code, e.g. USD." },
    cancel_policy: {
      type: "string",
      description: "One or two sentences: how to cancel, and any restrictions or deadlines.",
    },
    cancel_url: {
      type: "string",
      description: "URL of the official page where an account holder cancels or manages the subscription.",
    },
  },
  required: ["trial_days", "renewal_price", "currency", "cancel_policy", "cancel_url"],
} as const;

const rawTerms = z.object({
  trial_days: z.number().int().min(1).max(MAX_TRIAL_DAYS),
  renewal_price: z.number().min(0),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  cancel_policy: z.string().min(1),
  cancel_url: z.string().min(1),
});

export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isOnDomain(url: string, domain: string): boolean {
  const host = hostOf(url);
  const d = domain.toLowerCase();
  return host !== null && (host === d || host.endsWith(`.${d}`));
}

export function cleanText(raw: string, max: number): string {
  const cleaned = raw
    .replace(new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e]", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export type Validation =
  | { ok: true; terms: Omit<Terms, "source_urls">; warnings: string[] }
  | { ok: false; reason: string };

export function validateExaContent(
  content: unknown,
  service_domain: string,
  billingPortals: readonly string[] = DEFAULT_BILLING_PORTAL_DOMAINS,
): Validation {
  const parsed = rawTerms.safeParse(content);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(root)"))];
    return { ok: false, reason: `missing or invalid fields: ${fields.join(", ")}` };
  }
  const raw = parsed.data;

  const renewal_price_cents = Math.round(raw.renewal_price * 100);
  if (renewal_price_cents > MAX_PRICE_CENTS) {
    return { ok: false, reason: `price looks wrong (${renewal_price_cents} cents)` };
  }

  const warnings: string[] = [];
  const host = hostOf(raw.cancel_url);
  if (host === null) return { ok: false, reason: "cancel_url is not a valid https URL" };
  if (!isOnDomain(raw.cancel_url, service_domain)) {
    if (billingPortals.some((portal) => isOnDomain(raw.cancel_url, portal))) {
      warnings.push(`cancel_url is on a billing portal (${host}), not ${service_domain}`);
    } else {
      return { ok: false, reason: `cancel_url host ${host} is not ${service_domain} or a known billing portal` };
    }
  }

  return {
    ok: true,
    warnings,
    terms: {
      trial_days: raw.trial_days,
      renewal_price_cents,
      currency: raw.currency.toUpperCase(),
      cancel_policy: cleanText(raw.cancel_policy, MAX_POLICY_CHARS),
      cancel_url: raw.cancel_url,
    },
  };
}
