import type { EmailKind } from "./types.js";

// Deterministic, rule-based classifier. Pure function: no network, no model, no side effects.
//
// Why rules and not an LLM: email content is untrusted data (stop-loss skill, section 8).
// A regex cannot be talked into doing anything. The worst a crafted email can do here is
// get a wrong label, and a wrong label can only cause an approval prompt, never a cancel,
// because every cancellation needs explicit human approval downstream.
//
// Rules run in priority order against the SUBJECT first. The body preview is consulted only
// for login codes, because codes often live in the body and the subject can be generic.
// Order matters: a welcome email often mentions the trial length ("your trial ends Nov 1"),
// so only URGENT trial-ending phrasing is matched before "welcome".

type RuleKind = Exclude<EmailKind, "unclassified">;

interface Rule {
  id: string;
  kind: RuleKind;
  pattern: RegExp;
}

const APOS = "['’]?";

const SUBJECT_RULES: Rule[] = [
  // --- login codes ---
  {
    id: "login_code.1",
    kind: "login_code",
    pattern:
      /\b(?:verification|verify|security|login|log[- ]?in|sign[- ]?in|one[- ]time|authentication|access|confirmation)\s+(?:code|pin)\b/i,
  },
  {
    id: "login_code.2",
    kind: "login_code",
    pattern: /\b(?:your|the)\s+(?:code|pin|passcode)\s*(?:is|:)/i,
  },
  {
    id: "login_code.3",
    kind: "login_code",
    pattern: /\bis your (?:[\w-]+ ){0,3}(?:code|pin)\b/i,
  },
  { id: "login_code.4", kind: "login_code", pattern: /\b(?:otp|passcode)\b/i },

  // --- cancellation (related to a cancellation; NOT proof by itself, see README note) ---
  {
    id: "cancellation.1",
    kind: "cancellation",
    pattern: /\bcancel{1,2}(?:ed|ation)\b/i,
  },
  {
    id: "cancellation.2",
    kind: "cancellation",
    pattern: /\bsorry to see you go\b/i,
  },
  { id: "cancellation.3", kind: "cancellation", pattern: /\bunsubscribed\b/i },

  // --- urgent trial ending (before welcome on purpose) ---
  {
    id: "trial_ending.1",
    kind: "trial_ending",
    pattern: /\btrial\b.{0,40}\b(?:ending|expiring)\b/i,
  },
  {
    id: "trial_ending.2",
    kind: "trial_ending",
    pattern:
      /\b(?:ends?|expires?)\s+(?:tomorrow|today|tonight|soon|in\s+\d+\s+(?:days?|hours?))\b/i,
  },
  {
    id: "trial_ending.3",
    kind: "trial_ending",
    pattern: /\blast (?:day|chance)\b.{0,30}\btrial\b/i,
  },
  {
    id: "trial_ending.4",
    kind: "trial_ending",
    pattern: /\b\d+\s+days?\s+(?:left|remaining)\b/i,
  },
  {
    id: "trial_ending.5",
    kind: "trial_ending",
    pattern: new RegExp(
      `\\b(?:you${APOS}ll|you will|we${APOS}ll|we will)\\s+be\\s+charged\\b|\\bwe${APOS}ll\\s+charge\\b`,
      "i",
    ),
  },

  // --- welcome ---
  {
    id: "welcome.1",
    kind: "welcome",
    pattern:
      /\b(?:welcome|get(?:ting)? started|thanks for (?:signing up|joining|registering)|you(?:'|’)?re (?:in|all set)|activate your|account (?:created|is ready))\b/i,
  },
  {
    id: "welcome.2",
    kind: "welcome",
    pattern: /\b(?:confirm|verify) your (?:email|account|address)\b/i,
  },
  {
    id: "welcome.3",
    kind: "welcome",
    pattern:
      /\btrial\b.{0,20}\b(?:has )?(?:started|begun|begins|is (?:now )?active|starts)\b/i,
  },

  // --- receipt ---
  {
    id: "receipt.1",
    kind: "receipt",
    pattern:
      /\b(?:receipt|invoice|payment (?:received|successful|confirmation)|order confirmation)\b/i,
  },
  {
    id: "receipt.2",
    kind: "receipt",
    pattern: new RegExp(`\\byou${APOS}ve been charged\\b`, "i"),
  },

  // --- looser trial ending, e.g. "Your trial ends Nov 1" ---
  {
    id: "trial_ending.6",
    kind: "trial_ending",
    pattern: /\btrial\b.{0,40}\b(?:ends?|expires?)\b/i,
  },
];

const CODE_PHRASE =
  /\b(?:verification|login|log[- ]?in|sign[- ]?in|security|one[- ]time|confirmation)\s+code\b/i;
const CODE_DIGITS = /\b\d{4,8}\b/;

export interface Classification {
  kind: EmailKind;
  /** The rule id that matched, e.g. "subject:welcome.1", or "none". */
  classifiedBy: string;
}

export function classifyEmail(
  subject: string,
  bodyPreview: string,
): Classification {
  for (const rule of SUBJECT_RULES) {
    if (rule.pattern.test(subject)) {
      return { kind: rule.kind, classifiedBy: `subject:${rule.id}` };
    }
  }
  if (CODE_PHRASE.test(bodyPreview) && CODE_DIGITS.test(bodyPreview)) {
    return { kind: "login_code", classifiedBy: "body:login_code" };
  }
  return { kind: "unclassified", classifiedBy: "none" };
}
