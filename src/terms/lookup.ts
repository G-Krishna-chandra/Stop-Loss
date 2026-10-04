import type { Terms } from "../types.js";
import {
  DEFAULT_BILLING_PORTAL_DOMAINS,
  EXA_OUTPUT_SCHEMA,
  hostOf,
  validateExaContent,
} from "./validate.js";

// Finds the terms of a free trial (length, renewal price, cancel path) with Exa.
//
// Failure is a value, not an exception: a lookup that cannot find trustworthy terms returns
// { ok: false, reason } so the agent can mark the position and surface it. Nothing downstream
// ever receives half-validated data.

export interface ExaSearchResponse {
  results: Array<{ url: string }>;
  output?: {
    content: unknown;
    grounding?: Array<{
      field: string;
      confidence: "low" | "medium" | "high";
      citations: Array<{ url: string; title?: string }>;
    }>;
  };
}

/** The slice of the Exa client this module uses. The real client is wrapped in ./exa.ts. */
export interface ExaSearchClient {
  search(query: string, options: Record<string, unknown>): Promise<ExaSearchResponse>;
}

export interface TermsRequest {
  service_name: string;
  service_domain: string;
}

export type TermsResult =
  | {
      ok: true;
      terms: Terms;
      /** True when the answer came from the service's own domain. */
      official_source: boolean;
      /** Things a human should know before trusting this, e.g. a low-confidence field. */
      warnings: string[];
    }
  | { ok: false; reason: string };

export interface TermsLookup {
  lookupTerms(request: TermsRequest): Promise<TermsResult>;
}

export interface LookupOptions {
  client: ExaSearchClient;
  /** Exa search type that supports structured output. Defaults to "deep". */
  searchType?: "deep-lite" | "deep" | "deep-reasoning";
  billingPortals?: readonly string[];
  timeoutMs?: number;
}

const MAX_SOURCES = 5;

function sourceUrls(response: ExaSearchResponse): string[] {
  const urls: string[] = [];
  const add = (url: string) => {
    if (hostOf(url) !== null && !urls.includes(url)) urls.push(url);
  };
  for (const entry of response.output?.grounding ?? []) {
    for (const citation of entry.citations) add(citation.url);
  }
  for (const result of response.results) add(result.url);
  return urls.slice(0, MAX_SOURCES);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Exa lookup timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createTermsLookup(options: LookupOptions): TermsLookup {
  const searchType = options.searchType ?? "deep";
  const portals = options.billingPortals ?? DEFAULT_BILLING_PORTAL_DOMAINS;
  const timeoutMs = options.timeoutMs ?? 90_000;

  async function attempt(request: TermsRequest, officialOnly: boolean): Promise<TermsResult> {
    const query =
      `${request.service_name} (${request.service_domain}) free trial: how many days it lasts, ` +
      `the price charged when it ends, and how to cancel the subscription`;
    let response: ExaSearchResponse;
    try {
      response = await withTimeout(
        options.client.search(query, {
          type: searchType,
          outputSchema: EXA_OUTPUT_SCHEMA,
          ...(officialOnly ? { includeDomains: [request.service_domain] } : {}),
        }),
        timeoutMs,
      );
    } catch (error) {
      return { ok: false, reason: `Exa request failed: ${error instanceof Error ? error.message : String(error)}` };
    }

    const content = response.output?.content;
    if (content === undefined || content === null || typeof content !== "object") {
      return { ok: false, reason: "Exa returned no structured output" };
    }
    const checked = validateExaContent(content, request.service_domain, portals);
    if (!checked.ok) return { ok: false, reason: checked.reason };

    const warnings = [...checked.warnings];
    for (const entry of response.output?.grounding ?? []) {
      if (entry.confidence === "low") warnings.push(`low confidence in ${entry.field}`);
    }
    const sources = sourceUrls(response);
    if (sources.length === 0) return { ok: false, reason: "no source URLs, so the terms cannot be verified" };

    return {
      ok: true,
      terms: { ...checked.terms, source_urls: sources },
      official_source: officialOnly,
      warnings,
    };
  }

  return {
    async lookupTerms(request) {
      // Official pages first: better provenance, and a poisoned third-party page cannot win.
      const official = await attempt(request, true);
      if (official.ok) return official;
      const open = await attempt(request, false);
      if (open.ok) return { ...open, warnings: ["not found on the official site", ...open.warnings] };
      return { ok: false, reason: `official site: ${official.reason}; open web: ${open.reason}` };
    },
  };
}
