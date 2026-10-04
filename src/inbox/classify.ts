// Pure, deterministic email classification. No model calls: a hostile email cannot steer this.
import type { EmailKind } from '../types.js';

const RULES: [EmailKind, RegExp][] = [
  [
    'cancellation',
    /(subscription|plan|trial|membership)\b.{0,60}\b(has been |was |is now )?(cancell?ed|terminated)|\b(cancell?ed|terminated) (your|the) (subscription|plan|trial|membership)|cancellation (is )?confirm|you('ve| have) cancell?ed|sorry to see you go/i,
  ],
  [
    'trial_ending',
    /trial (ends|is ending|will end|expires|is expiring|ending soon)|(\d+|one|two|three|seven) days? (left|remaining) (in|on) your (free )?trial|your (free )?trial ends/i,
  ],
  [
    'login_code',
    /(verification|login|log-in|sign[- ]?in|sign[- ]?up|one[- ]time|security|confirmation) (code|link)|magic link|your code is|verify your (email|login)|passcode|\botp\b/i,
  ],
  ['receipt', /\breceipt\b|\binvoice\b|payment (received|confirm|successful)|you('ve| have| were) been charged|order confirm/i],
  [
    'welcome',
    /welcome|thanks for (signing up|joining)|get(ting)? started|your (free )?trial (has )?(started|begins|is active)|account (has been )?created/i,
  ],
];

export function classify(subject: string, body: string): EmailKind {
  const haystack = `${subject}\n${body.slice(0, 4000)}`;
  // Subject is the strongest signal, so check it alone first.
  for (const [kind, re] of RULES) if (re.test(subject)) return kind;
  for (const [kind, re] of RULES) if (re.test(haystack)) return kind;
  return 'other';
}

const CODE_NEAR_WORD = /(?:code|passcode|otp|verification)[^A-Za-z0-9]{0,40}\b([0-9]{4,8}|[A-Z0-9]{3}-?[A-Z0-9]{3})\b/i;
const STANDALONE_DIGITS = /(?:^|\s)([0-9]{6})(?:\s|$)/m;

export function extractLoginCode(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`;
  const near = text.match(CODE_NEAR_WORD);
  if (near?.[1] && /\d/.test(near[1])) return near[1];
  return text.match(STANDALONE_DIGITS)?.[1] ?? null;
}

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
const MAGIC_HINT = /(login|log-in|signin|sign-in|sign_in|magic|verify|auth|token|confirm)/i;

export function extractMagicLink(body: string, serviceDomain: string): string | null {
  for (const url of body.match(URL_RE) ?? []) {
    try {
      const u = new URL(url);
      // Only links on the service's own domain. Never follow a link to a third-party host.
      if (!hostMatches(u.hostname, serviceDomain)) continue;
      if (MAGIC_HINT.test(u.pathname + u.search)) return u.toString();
    } catch {
      // not a URL
    }
  }
  return null;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

const TWO_PART_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

/** "Notion Team <team@mail.notion.so>" -> { name: "Notion", domain: "notion.so" } */
export function parseSender(from: string): { name: string; domain: string } {
  const addr = from.match(/<([^>]+)>/)?.[1] ?? from;
  const host = (addr.split('@')[1] ?? '').toLowerCase().trim();
  const labels = host.split('.').filter(Boolean);
  const n =
    labels.length >= 3 && TWO_PART_SUFFIXES.has(labels.at(-2)!) && labels.at(-1)!.length === 2 ? 3 : 2;
  const domain = labels.slice(-n).join('.');

  const display = from.includes('<') ? from.slice(0, from.indexOf('<')).replace(/["']/g, '').trim() : '';
  const cleaned = display
    .replace(/\b(team|support|billing|hello|no-?reply|notifications?|from|the|account|accounts)\b/gi, '')
    .replace(/[^\p{L}\p{N} .&+-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = labels.at(-n) ?? domain;
  const name = cleaned || base.charAt(0).toUpperCase() + base.slice(1);
  return { name, domain };
}
