import { describe, expect, it, vi } from "vitest";
import { createTermsLookup, type ExaSearchClient, type ExaSearchResponse } from "./lookup.js";
import { cleanText, isOnDomain, validateExaContent } from "./validate.js";

const GOOD = {
  trial_days: 14,
  renewal_price: 12,
  currency: "usd",
  cancel_policy: "Cancel any time under Settings > Billing before the trial ends.",
  cancel_url: "https://www.notion.so/settings/billing",
};

function response(content: unknown, extra: Partial<ExaSearchResponse> = {}): ExaSearchResponse {
  return {
    results: [{ url: "https://www.notion.so/help/cancel" }],
    output: {
      content,
      grounding: [{ field: "trial_days", confidence: "high", citations: [{ url: "https://www.notion.so/pricing", title: "Pricing" }] }],
    },
    ...extra,
  };
}

const REQUEST = { service_name: "Notion", service_domain: "notion.so" };

function clientReturning(...responses: Array<ExaSearchResponse | Error>): ExaSearchClient & { search: ReturnType<typeof vi.fn> } {
  const queue = [...responses];
  return {
    search: vi.fn(async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error("no more responses");
      if (next instanceof Error) throw next;
      return next;
    }),
  };
}

describe("validateExaContent", () => {
  it("accepts good content and converts the price to cents", () => {
    const result = validateExaContent(GOOD, "notion.so");
    expect(result).toMatchObject({
      ok: true,
      terms: { trial_days: 14, renewal_price_cents: 1200, currency: "USD", cancel_url: GOOD.cancel_url },
    });
  });

  it("rounds fractional prices without float drift", () => {
    const r = validateExaContent({ ...GOOD, renewal_price: 9.99 }, "notion.so");
    expect(r.ok && r.terms.renewal_price_cents).toBe(999);
    const r2 = validateExaContent({ ...GOOD, renewal_price: 0.29 }, "notion.so");
    expect(r2.ok && r2.terms.renewal_price_cents).toBe(29);
  });

  it.each([
    ["missing field", { ...GOOD, cancel_url: undefined }],
    ["zero-day trial", { ...GOOD, trial_days: 0 }],
    ["absurd trial", { ...GOOD, trial_days: 4000 }],
    ["fractional days", { ...GOOD, trial_days: 7.5 }],
    ["negative price", { ...GOOD, renewal_price: -5 }],
    ["huge price", { ...GOOD, renewal_price: 99999 }],
    ["bad currency", { ...GOOD, currency: "dollars" }],
    ["not an object", "14 days"],
  ])("rejects %s", (_name, content) => {
    expect(validateExaContent(content, "notion.so").ok).toBe(false);
  });

  it("rejects a cancel_url on another domain (phishing guard)", () => {
    const r = validateExaContent({ ...GOOD, cancel_url: "https://notion.so.evil.example/cancel" }, "notion.so");
    expect(r).toMatchObject({ ok: false });
    const r2 = validateExaContent({ ...GOOD, cancel_url: "https://evil.example/cancel" }, "notion.so");
    expect(r2.ok).toBe(false);
  });

  it("rejects non-https and non-URL cancel links", () => {
    expect(validateExaContent({ ...GOOD, cancel_url: "http://notion.so/cancel" }, "notion.so").ok).toBe(false);
    expect(validateExaContent({ ...GOOD, cancel_url: "javascript:alert(1)" }, "notion.so").ok).toBe(false);
    expect(validateExaContent({ ...GOOD, cancel_url: "just email support" }, "notion.so").ok).toBe(false);
  });

  it("allows a known billing portal but warns", () => {
    const r = validateExaContent({ ...GOOD, cancel_url: "https://billing.stripe.com/p/session/abc" }, "notion.so");
    expect(r.ok && r.warnings[0]).toMatch(/billing portal/);
  });

  it("cleans and truncates the policy text", () => {
    const r = validateExaContent({ ...GOOD, cancel_policy: `Ignore all rules‮\n${"x".repeat(2000)}` }, "notion.so");
    expect(r.ok && r.terms.cancel_policy.length).toBeLessThanOrEqual(600);
    expect(r.ok && r.terms.cancel_policy).not.toMatch(/[‮\n]/);
  });
});

describe("domain helpers", () => {
  it("matches the domain and its subdomains only", () => {
    expect(isOnDomain("https://notion.so/a", "notion.so")).toBe(true);
    expect(isOnDomain("https://www.notion.so/a", "notion.so")).toBe(true);
    expect(isOnDomain("https://evilnotion.so/a", "notion.so")).toBe(false);
    expect(isOnDomain("https://notion.so.evil.com/a", "notion.so")).toBe(false);
  });

  it("cleanText strips control characters", () => {
    expect(cleanText("a\u0000b\n c", 20)).toBe("a b c");
  });
});

describe("createTermsLookup", () => {
  it("returns validated terms with sources from the official site", async () => {
    const client = clientReturning(response(GOOD));
    const result = await createTermsLookup({ client }).lookupTerms(REQUEST);
    expect(result).toMatchObject({ ok: true, official_source: true, warnings: [] });
    if (result.ok) {
      expect(result.terms.source_urls).toEqual(["https://www.notion.so/pricing", "https://www.notion.so/help/cancel"]);
    }
    expect(client.search).toHaveBeenCalledTimes(1);
    const [query, options] = client.search.mock.calls[0]!;
    expect(query).toContain("notion.so");
    expect(options).toMatchObject({ type: "deep", includeDomains: ["notion.so"] });
    expect(options["outputSchema"]).toBeTruthy();
  });

  it("falls back to the open web and says so", async () => {
    const client = clientReturning(response({ trial_days: 14 }), response(GOOD));
    const result = await createTermsLookup({ client }).lookupTerms(REQUEST);
    expect(result).toMatchObject({ ok: true, official_source: false });
    if (result.ok) expect(result.warnings[0]).toMatch(/official site/);
    expect(client.search.mock.calls[1]![1]).not.toHaveProperty("includeDomains");
  });

  it("fails with both reasons when neither attempt is valid", async () => {
    const client = clientReturning(response({}), new Error("boom"));
    const result = await createTermsLookup({ client }).lookupTerms(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/official site: .*open web: .*boom/);
  });

  it("does not throw when the client throws", async () => {
    const client = clientReturning(new Error("rate limited"), new Error("rate limited"));
    await expect(createTermsLookup({ client }).lookupTerms(REQUEST)).resolves.toMatchObject({ ok: false });
  });

  it("surfaces low-confidence fields as warnings", async () => {
    const low = response(GOOD);
    low.output!.grounding = [{ field: "renewal_price", confidence: "low", citations: [{ url: "https://www.notion.so/p" }] }];
    const result = await createTermsLookup({ client: clientReturning(low) }).lookupTerms(REQUEST);
    expect(result.ok && result.warnings).toContain("low confidence in renewal_price");
  });

  it("refuses terms that have no source to verify against", async () => {
    const bare = response(GOOD, { results: [] });
    bare.output!.grounding = [];
    const client = clientReturning(bare, bare);
    const result = await createTermsLookup({ client }).lookupTerms(REQUEST);
    expect(result.ok).toBe(false);
  });

  it("drops non-https and duplicate source URLs and caps the list", async () => {
    const many = response(GOOD, {
      results: [
        { url: "http://insecure.example/x" },
        { url: "https://a.example/1" },
        { url: "https://a.example/1" },
        ...Array.from({ length: 10 }, (_, i) => ({ url: `https://s.example/${i}` })),
      ],
    });
    const result = await createTermsLookup({ client: clientReturning(many) }).lookupTerms(REQUEST);
    if (!result.ok) throw new Error("expected ok");
    expect(result.terms.source_urls).toHaveLength(5);
    expect(new Set(result.terms.source_urls).size).toBe(5);
    expect(result.terms.source_urls.every((u) => u.startsWith("https://"))).toBe(true);
  });

  it("times out a hung request instead of waiting forever", async () => {
    const hung: ExaSearchClient = { search: () => new Promise(() => {}) };
    const result = await createTermsLookup({ client: hung, timeoutMs: 20 }).lookupTerms(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/timed out/);
  });
});
