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

## Models: Neon AI Gateway

Sources: neon.com/docs/ai-gateway/get-started.md, /docs/ai-gateway/models.md, npm `@neon/ai-sdk-provider` README

- Credentials come from the branch's AI Gateway tab in the Neon console: `NEON_AI_GATEWAY_BASE_URL` (branch-scoped host) and `NEON_AI_GATEWAY_TOKEN`.
- `src/llm.ts` calls `createNeon({ baseURL, apiKey })(modelId)` from `@neon/ai-sdk-provider`, which works with AI SDK 6 and 7.
- Claude ids are `claude-sonnet-5`, `claude-haiku-4-5`, and `claude-opus-5-5`. Claude goes through the Anthropic Messages route, which supports tools and structured output.
- `GET $NEON_AI_GATEWAY_BASE_URL/v1/models` lists the models your branch serves.
- AI SDK 7 needs Node 22 or later, and this repo pins Node 24. For structured output, use `generateText({ model, output: Output.object({ schema }) })`.

## Local mail without a public URL

`npm run inbox:listen` subscribes to the StopLoss inbox over AgentMail WebSockets (`client.websockets.connect()`, then `sendSubscribe({ type: "subscribe", inboxIds, eventTypes })`). It forwards each `message.received` to the local webhook route. The route accepts unsigned events only when `NODE_ENV` is not production and `ALLOW_UNSIGNED_WEBHOOKS=1`.

## Kernel Link wallet (single-use cards)

Sources: kernel.sh/docs integrations/wallets/stripe-link.md, integrations/wallets/overview.md, vaults/fill.md

- Setup: one vault (`STOPLOSS_VAULT_NAME`, default `stoploss-user`) holds one Link wallet, `link-wallet`. Create it with `kernel.vaults.items.upsert(key, { type: "wallet", spec: { provider: "link", authorization: { method: "oauth", client: { type: "kernel_managed" } } } })`. While its state is `pending_authorization`, `action.url` is the hosted Link sign-in that the user opens.
- Issuing a card, once per sign-up run: the card is keyed `trial-<runId>`, with `amount` in cents (1 to 50000; we use 100) and a `merchant_url` set to the checkout page's https origin. `context` must be at least 100 characters.
  - Call `authorize` once, then wait for `ready`. A `spend_approval` action has a URL; `push_approval` means approving in the Link app.
- Filling: `performOperation(key, { type: "fill", browser_id, page_url, fields: [{ field, selector }] })`.
  - `page_url` must share the origin of `merchant_url`.
  - `expiration` needs `format: "MM/YY"`.
  - Never retry a fill or an authorize. A missing billing field returns `field_unavailable` before anything is written to the page, so we retry once with card fields only.
- Rules: browsers that fill need `vaults: [{ name }]` at creation. Link runs live only and needs a US phone number. Keep action URLs out of model context.

## ElevenLabs Agents (voice)

Sources: elevenlabs.io/docs eleven-agents libraries/react, api-reference (agents, tools, conversations/token), customization/events

- Browser: `@elevenlabs/react` provides `ConversationProvider`, `useConversationControls` (`startSession`, `sendContextualUpdate`, `sendUserMessage`, `endSession`), `useConversationClientTool(name, handler)`, and `useConversationStatus` / `useConversationMode` / `useConversationInput`.
- Server: `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=...` with the `xi-api-key` header returns `{ token }`. Start a session with `startSession({ conversationToken, connectionType: "webrtc" })`.
- Agent setup: `POST /v1/convai/tools` creates client tools (`expects_response: true`). `POST /v1/convai/agents/create` with `conversation_config.agent.prompt.tool_ids` and `platform_settings.auth.enable_auth: true`. Conversations are capped by `max_duration_seconds` (we use 1800).
