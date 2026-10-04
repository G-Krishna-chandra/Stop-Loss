import type { Position } from "../types.js";

// Builds and cleans the text a human reads when deciding. Pure functions.

export const MAX_DETAIL_CHARS = 500;

/** Strips control and bidi characters, collapses whitespace, truncates. Text may come from a web page. */
export function sanitizeDetail(raw: string): string {
  const cleaned = raw
    .replace(new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e]", "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > MAX_DETAIL_CHARS ? `${cleaned.slice(0, MAX_DETAIL_CHARS - 1)}…` : cleaned;
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`; // not a valid ISO currency code
  }
}

/** The sentence shown on an approval card: what will be cancelled, when it renews, what it costs. */
export function describeCancel(position: Position): string {
  const price =
    position.renewal_price_cents !== null && position.currency !== null
      ? formatMoney(position.renewal_price_cents, position.currency)
      : "an unknown price";
  const when = position.renewal_date ? ` on ${position.renewal_date}` : "";
  return sanitizeDetail(
    `Cancel ${position.service_name} (${position.service_domain}) before it renews${when} for ${price}.`,
  );
}
