// Small registrable-domain helper so "mail.notion.so" and "notion.so" map to the same service.
// Deliberately tiny: a handful of common two-part suffixes instead of the full public suffix list.
// Known limit: an unlisted two-part suffix (e.g. "example.co.xx") collapses to "co.xx".
// The Position's service_domain is what src/agent should actually match against.

const TWO_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.in",
  "co.jp",
  "com.br",
  "com.mx",
  "com.sg",
  "co.za",
]);

export function registrableDomain(host: string): string {
  const labels = host
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  const take = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Extracts "user@host" from "Name <user@host>" or a bare address. Returns null if invalid. */
export function extractAddress(raw: string): string | null {
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(raw);
  const candidate = (angle?.[1] ?? raw).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate) ? candidate : null;
}

export function domainOfAddress(address: string): string {
  const host = address.slice(address.lastIndexOf("@") + 1);
  return registrableDomain(host);
}
