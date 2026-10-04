// Local webhook receiver for src/inbox wired to src/db (in-memory backend, nothing persisted).
// Verifies signatures, classifies, records events, and opens a position on a welcome email.
// This file is the composition root: it is the one place that connects inbox's `emit` to db.
// Run: npm run inbox:dev
// To receive real AgentMail webhooks, expose this port with a tunnel and register the URL.
import { createServer } from "node:http";
import { createMemoryDb } from "../src/db/index.js";
import { sendWebResponse, toWebRequest } from "./http.js";
import { createInboxHandler, createVerifier } from "../src/inbox/index.js";

const secret = process.env["AGENTMAIL_WEBHOOK_SECRET"];
if (!secret) {
  console.error("AGENTMAIL_WEBHOOK_SECRET is not set (see .env.example)");
  process.exit(1);
}
const port = Number(process.env["PORT"] ?? 8787);

const db = createMemoryDb();
const handle = createInboxHandler({
  verify: createVerifier(secret),
  emit: async (event) => {
    const result = await db.emit(event);
    console.log("EVENT", JSON.stringify(event, null, 2));
    console.log("RESULT", JSON.stringify(result), "exposure", JSON.stringify(await db.getExposure()));
    for (const position of await db.listPositions()) {
      console.log("POSITION", position.id, position.service_name, position.status);
    }
    return result;
  },
  log: (entry) => console.log(JSON.stringify(entry)),
});

createServer(async (req, res) => {
  await sendWebResponse(res, await handle(await toWebRequest(req)));
}).listen(port, () => console.log(`inbox dev server on http://localhost:${port}`));
