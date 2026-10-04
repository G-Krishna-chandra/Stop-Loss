# Integration notes

These notes come from the official docs, read on October 4, 2026. Each section links its sources. If something here disagrees with the docs, the docs win. Fix this file in the same PR.

## AgentMail

Sources: docs.agentmail.to/quickstart.md, /inboxes.md, /messages.md, /webhooks-overview.md, /webhook-verification.md, /labels.md

- Setup: `npm i agentmail`, then `new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY })`.
- Create the inbox: `client.inboxes.create({ username, domain?, displayName?, clientId? })`. The domain defaults to `agentmail.to`. Passing a `clientId` makes the call idempotent. The response includes `inboxId` and `email`.
- List and read: `client.inboxes.messages.list(inboxId, { limit, pageToken, labels })`. List items carry `preview` but no body, so call `client.inboxes.messages.get(inboxId, messageId)` for `text`, `html`, and `extractedText`. `text` can be missing, so treat `html` as the main body.
- Webhook registration: `client.webhooks.create({ url, eventTypes: ["message.received"], clientId })`.
- Webhook payload: `{ type: "event", event_type: "message.received", event_id, message, thread }`. The overview page shows a slightly different shape, so parse defensively. Payloads over 1 MB drop `text` and `html`, so fetch the full message.
- Webhook verification: Svix headers `svix-id`, `svix-timestamp`, and `svix-signature`, checked against a `whsec_...` secret with `new Webhook(secret).verify(rawBody, headers)`. Verify the raw body, and return 200 fast.
- Labels: `client.inboxes.messages.update(inboxId, messageId, { addLabels, removeLabels })`.

## Exa

Sources: exa.ai/docs/sdks/quickstart.md, /reference/search.md, /search/deep-search.md, /admin/pricing.md

- Setup: `npm i exa-js`, then `new Exa()`, which reads `EXA_API_KEY`.
- Trial terms with sources: `exa.search(query, { type: "deep-lite", includeDomains, outputSchema, contents: { highlights: true } })`.
  - `r.output.content` is the object that matches the schema.
  - `r.output.grounding[]` gives `{ field, citations: [{ url, title }], confidence }`.
- Schema limits: at most 10 properties in total and 2 levels of nesting. Leave citations out of the schema.
- Speed and limits: `deep-lite` takes about 4 s. Deep search is limited to 5 QPS.

## Kernel

Sources: kernel.sh/docs/llms.txt, browsers/live-view.md, browsers/profiles/*.md, auth/hosted-ui.md, vaults/*.md, browsers/replays.md, info/pricing.md

- Setup: `npm i @onkernel/sdk`, then `new Kernel()`, which reads `KERNEL_API_KEY`. Requests go to the "Default" project unless you pass `projectID`.
- Create a browser: `kernel.browsers.create({ stealth, headless: false, timeout_seconds, profile: { name, save_changes } })`.
  - It returns `session_id`, `cdp_ws_url`, and `browser_live_view_url`.
  - Delete it with `kernel.browsers.deleteByID(id)`.
- Live view: the URL can be embedded in an iframe. Add `?readOnly=true` to make it view-only. The CSP needs `frame-src` and `connect-src` for `*.onkernel.com:8443` and `*.kernel.sh:8443`.
- Driving the browser:
  - Kernel recommends Playwright execution first and computer use as the fallback.
  - `kernel.browsers.playwright.execute(id, { code })` runs Playwright code against the browser.
  - `@onkernel/cua-agent` runs a computer-use agent (`new CuaAgent({ browser, client, initialState: { model, systemPrompt } }).prompt(...)`).
- Profiles: these persist cookies and storage. Several browsers can read one profile at once. When more than one browser saves, the last save wins.
- Managed Auth signs a user in once:
  1. `kernel.auth.connections.create({ domain, profile_name })`
  2. `connections.login(id)` returns a `hosted_url` that the user opens.
  3. `connections.follow(id)` streams events until `flow_status === "SUCCESS"`.
  4. Later, `browsers.create({ profile: { name } })` starts a browser that is already signed in.
  - If the site sends an email or SMS code, the connection goes to `NEEDS_AUTH`.
- Vaults: `fill` puts values into page fields without passing them through our app or the model. A page script can still read those values once they are in the page.
- Cards: Kernel does not issue cards. Single-use cards come from a wallet provider such as Link by Stripe, which runs live only and needs a US phone number.
- Replays: `kernel.browsers.replays.start(id)` and `replays.stop(replayId, { id })`. The `replay_view_url` can be embedded.
- Developer plan limits: 5 concurrent browsers, and replays are kept for 1 day.

## Mastra

Sources: mastra.ai/docs/workflows/suspend-and-resume.md, /human-in-the-loop.md, /integrations/frameworks/next-js.md, /integrations/databases/postgresql.md, /docs/deployment/web-framework.md

- Next.js setup: export a `mastra` instance from `src/agent/mastra.ts`, call it from route handlers, and set `serverExternalPackages: ["@mastra/*"]` in `next.config.ts`.
- Workflows: `createStep({ id, inputSchema, outputSchema, resumeSchema, execute: ({ inputData, resumeData, suspend }) => ... })`.
  - `createWorkflow(...).then(step).commit()`.
  - `run = await wf.createRun()`, then `run.start({ inputData })`. When `result.status === "suspended"` the run is waiting.
  - To resume later, call `wf.createRun({ runId })` and then `run.resume({ resumeData })`.
- Storage: suspend and resume across requests needs `new PostgresStore({ id, connectionString })` from `@mastra/pg`. Do not use LibSQL on serverless.
- Models: through the gateway, Mastra models look like `"vercel/anthropic/claude-sonnet-5"`, which uses `AI_GATEWAY_API_KEY`.

## Neon

Sources: neon.com/docs/serverless/serverless-driver, /guides/nextjs, /connect/connection-pooling

- Querying: `neon(DATABASE_URL)` returns a tagged-template function, and its parameters are escaped. Timestamps come back as `Date`.
- Connection strings: use the pooled string (`-pooler`) in the app, and the direct string for migrations.

## AI SDK and AI Gateway

Sources: ai-sdk.dev/docs/migration-guides/migration-guide-7-0, /docs/ai-sdk-core/generating-structured-data, vercel.com/docs/ai-gateway

- AI SDK 7 needs Node 22 or later (this repo pins Node 24 in `.nvmrc`). A plain `"provider/model"` string routes through the gateway using `AI_GATEWAY_API_KEY`.
- Structured output: call `generateText({ model, output: Output.object({ schema }), prompt })`. `generateObject` is deprecated.
