// Rule-based email classification. Email content is data: these rules only label it, they never act on it.
import type { EmailCategory } from "@/types";

export type Sender = { name: string | null; address: string; domain: string };

const MULTI_PART_TLDS = new Set(["co.uk", "com.au", "co.jp", "co.in", "com.br", "co.nz"]);

// "mail.cursor.com" -> "cursor.com", "app.example.co.uk" -> "example.co.uk"
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const lastTwo = parts.slice(-2).join(".");
  return MULTI_PART_TLDS.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

// "Cursor <hi@mail.cursor.com>" -> { name: "Cursor", address: "hi@mail.cursor.com", domain: "cursor.com" }
export function parseSender(from: string): Sender {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const address = (match ? match[2] : from).trim().toLowerCase();
  const name = match && match[1].trim() ? match[1].trim() : null;
  return { name, address, domain: registrableDomain(address.split("@")[1] ?? "") };
}

// Best guess at the product name: the sender's display name without "Team", else the domain's first label.
export function serviceName(sender: Sender): string {
  const cleaned = (sender.name ?? "")
    .replace(/^the\s+/i, "")
    .replace(/\s+(team|support|billing|notifications?|no-?reply)$/i, "")
    .replace(/\s+from\s+.*$/i, "")
    .trim();
  if (cleaned && !cleaned.includes("@")) return cleaned;
  const label = sender.domain.split(".")[0] ?? sender.domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const RULES: [EmailCategory, RegExp][] = [
  ["cancellation", /\b(subscription|plan|trial|membership)\b[^.]{0,40}\b(has been |was |is )?(cancell?ed|canceled|ended)\b|\bcancell?ation (confirmed|confirmation)\b|\byou(?:'|’)ve cancell?ed\b/i],
  ["login_code", /\b(login|log-in|sign[- ]?in|verification|security|one[- ]time)\s+(code|link)\b|\bmagic link\b|\byour code is\b/i],
  ["account_setup", /\b(confirm|verify) your (email|account|address)\b/i],
  ["trial_ending", /\btrial\b[^.]{0,30}\b(ends?|ending|expires?|expiring|will end|is over)\b|\b(renews?|renewal)\b[^.]{0,30}\b(tomorrow|soon|in \d+ days?)\b|\btrial ends tomorrow\b/i],
  ["welcome", /\bwelcome\b|\btrial (has )?(started|begun|is active)\b|\bstart(ed)? your (free )?trial\b|\bthanks for (signing up|joining)\b|\byour (free )?trial\b/i],
  ["receipt", /\b(receipt|invoice|payment (received|confirmation)|order confirmation)\b/i],
];

export function classify(subject: string, text: string): EmailCategory {
  const head = `${subject}\n${text.slice(0, 2000)}`;
  // The subject decides first, so a welcome email that mentions "cancel anytime" stays a welcome.
  for (const [category, re] of RULES) if (re.test(subject)) return category;
  for (const [category, re] of RULES) if (re.test(head)) return category;
  return "other";
}
