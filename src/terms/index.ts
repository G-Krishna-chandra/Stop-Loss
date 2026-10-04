// Public surface of src/terms. Other modules import from here and nowhere deeper.
export { createTermsLookup } from "./lookup.js";
export type {
  ExaSearchClient,
  ExaSearchResponse,
  LookupOptions,
  TermsLookup,
  TermsRequest,
  TermsResult,
} from "./lookup.js";
export { createExaClient } from "./exa.js";
export { DEFAULT_BILLING_PORTAL_DOMAINS, isOnDomain } from "./validate.js";
