import { z } from "zod";

// A recipe is the Playwright code that runs INSIDE the Kernel browser (where `page` exists).
// It returns { outcome, detail }. The canceller validates that shape and treats anything else as
// a failure, because an unclear result must never be read as success.
//
// Safety properties of the generic recipe (all covered by tests against a real Chromium):
//  - It never types a password or touches payment fields. A password form means needs_login.
//  - It only clicks controls whose accessible name says cancel/end subscription|plan|trial|
//    membership, and never ones that say delete, close account, keep, go back or stay.
//  - Success is only believed AFTER at least one click. "You will not be charged if you cancel"
//    on the first page is not a cancellation.
//  - A retention offer ("50% off", "pause instead") STOPS the flow. It does not accept or decline.
//  - At most 4 clicks, then it gives up as failed instead of wandering.
//  - It is best effort on unknown sites. Per-service recipes (below) override it for the services
//    chosen for the demo, after testing on the real accounts.

export const PAGE_OUTCOMES = ["cancelled", "retention_offer", "needs_login", "failed"] as const;

export const PageResult = z.object({
  outcome: z.enum(PAGE_OUTCOMES),
  detail: z.string(),
});
export type PageResult = z.infer<typeof PageResult>;

export interface RecipeInput {
  cancel_url: string;
  service_name: string;
}

export interface CancelRecipe {
  id: string;
  matches(service_domain: string): boolean;
  /** Source of an async function body. May use `page` and must `return { outcome, detail }`. */
  buildCode(input: RecipeInput): string;
}

export const GENERIC_RECIPE: CancelRecipe = {
  id: "generic",
  matches: () => true,
  buildCode(input) {
    // JSON.stringify yields a valid JS literal, so untrusted strings can never become code.
    return `
const input = ${JSON.stringify({ cancel_url: input.cancel_url })};
const MAX_CLICKS = 4;
const CANCEL_CONTROL = /cancel\\s+(my\\s+|your\\s+|the\\s+)?(subscription|plan|trial|membership)|end\\s+(my\\s+|your\\s+)?(subscription|trial|membership)|cancel\\s+trial|continue\\s+to\\s+cancel|confirm\\s+cancell?ation|yes,?\\s*cancel/i;
const NOT_THESE = /delete|close\\s+(my\\s+|your\\s+)?account|\\bkeep\\b|go\\s+back|never\\s*mind|don'?t\\s+cancel|\\bstay\\b/i;
const SUCCESS = /successfully\\s+cancell?ed|cancellation\\s+(is\\s+)?(confirmed|complete)|(subscription|plan|membership|trial)[^.\\n]{0,40}\\b(has\\s+been|is\\s+now|was)\\s+cancell?ed|you(?:'|\\u2019)?ve\\s+cancell?ed/i;
const OFFER = /\\d+\\s*%\\s*off|special\\s+offer|discount|free\\s+months?|pause\\s+(your\\s+)?(subscription|plan|membership)\\s+instead/i;

const bodyText = async () => {
  try { return (await page.locator("body").innerText({ timeout: 5000 })).slice(0, 30000); }
  catch { return ""; }
};
const snippet = (text, re) => {
  const m = re.exec(text);
  if (!m) return "";
  return text.slice(Math.max(0, m.index - 80), m.index + 160).replace(/\\s+/g, " ").trim();
};

await page.goto(input.cancel_url, { waitUntil: "domcontentloaded", timeout: 30000 });

for (let clicks = 0; clicks <= MAX_CLICKS; clicks++) {
  await page.waitForTimeout(600);
  const text = await bodyText();
  if (await page.locator('input[type="password"]').count() > 0) {
    return { outcome: "needs_login", detail: "a login or password form is showing" };
  }
  if (clicks > 0) {
    if (SUCCESS.test(text)) return { outcome: "cancelled", detail: snippet(text, SUCCESS) };
    if (OFFER.test(text)) return { outcome: "retention_offer", detail: snippet(text, OFFER) };
  }
  if (clicks === MAX_CLICKS) break;

  let clicked = false;
  for (const role of ["button", "link"]) {
    const candidates = page.getByRole(role, { name: CANCEL_CONTROL });
    const count = await candidates.count();
    for (let i = 0; i < count && !clicked; i++) {
      const el = candidates.nth(i);
      if (!(await el.isVisible())) continue;
      const label = (await el.innerText().catch(() => "")) || (await el.getAttribute("aria-label").catch(() => "")) || "";
      if (NOT_THESE.test(label)) continue;
      await el.click({ timeout: 5000 });
      clicked = true;
    }
    if (clicked) break;
  }
  if (!clicked) return { outcome: "failed", detail: "no cancel control found on the page" };
}
return { outcome: "failed", detail: "did not reach a cancellation confirmation" };
`;
  },
};

/**
 * Per-service recipes go here once the demo services are chosen and tested on real accounts.
 * Each one overrides the generic flow for its domain, e.g.:
 *   { id: "example", matches: (d) => d === "example.com", buildCode: (input) => `...` }
 */
export const SERVICE_RECIPES: readonly CancelRecipe[] = [];

export function pickRecipe(service_domain: string, recipes: readonly CancelRecipe[] = SERVICE_RECIPES): CancelRecipe {
  return recipes.find((r) => r.matches(service_domain.toLowerCase())) ?? GENERIC_RECIPE;
}
