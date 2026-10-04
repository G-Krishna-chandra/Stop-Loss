import { Exa } from "exa-js";
import type { ExaSearchClient } from "./lookup.js";

// The only file that imports exa-js. Exact calls from the Exa docs:
//   const exa = new Exa(apiKey)            (or no argument: reads EXA_API_KEY)
//   exa.search(query, { type, outputSchema, includeDomains })  -> { results, output: { content, grounding } }
// `outputSchema` is available on the deep search types ("deep-lite" | "deep" | "deep-reasoning").
export function createExaClient(apiKey?: string): ExaSearchClient {
  const exa = apiKey ? new Exa(apiKey) : new Exa();
  return {
    // The SDK's overloads are strict about option shapes; this boundary is validated at runtime
    // by validateExaContent, so the cast keeps the rest of the module free of SDK types.
    search: (query, options) => exa.search(query, options as never) as unknown as ReturnType<ExaSearchClient["search"]>,
  };
}
