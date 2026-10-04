// The composition root: wires every module into one running server.
//
//   npm run agent:run              real services where keys exist
//   npm run agent:run -- --fake    fake Exa and Kernel, so the whole loop runs with no keys (demo rehearsal)
//
// Routes
//   POST /webhooks/agentmail (or /)   AgentMail webhook -> src/inbox -> agent
//   GET  /health
//   DEV ONLY, need header `x-dev-token: $DEV_APPROVAL_TOKEN` (disabled when the variable is unset):
//   GET  /approvals                   pending approvals
//   POST /approvals/:id/approve       resolve an approval (stop-loss skill, section 3: "a plain HTTP endpoint")
//   POST /approvals/:id/decline
//   GET  /positions                   every position, for inspection
//
// This is not the product's user surface. That decision is still open.
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createAgent } from "../src/agent/index.js";
import { createApprovalService } from "../src/approval/index.js";
import { createCanceller, createKernelApi, type Canceller } from "../src/cancel/index.js";
import { createMemoryDb, createNeonDb, type Db } from "../src/db/index.js";
import { createInboxHandler, createVerifier } from "../src/inbox/index.js";
import { createExaClient, createTermsLookup, type TermsLookup } from "../src/terms/index.js";
import { sendWebResponse, toWebRequest } from "./http.js";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file; use the shell environment
}

const env = process.env;
const fake = process.argv.includes("--fake");
const log = (entry: object) => console.log(JSON.stringify(entry));

const webhookSecret = env["AGENTMAIL_WEBHOOK_SECRET"];
if (!webhookSecret) {
  console.error("AGENTMAIL_WEBHOOK_SECRET is not set (see .env.example)");
  process.exit(1);
}

// ---- pick real or fake services ------------------------------------------------------------
const db: Db = env["DATABASE_URL"] ? createNeonDb(env["DATABASE_URL"]) : createMemoryDb();
log({ msg: "db", backend: env["DATABASE_URL"] ? "neon" : "memory (nothing is persisted)" });

const terms: TermsLookup = fake
  ? {
      async lookupTerms({ service_domain }) {
        return {
          ok: true,
          official_source: true,
          warnings: ["FAKE terms for rehearsal"],
          terms: {
            trial_days: 7,
            renewal_price_cents: 1200,
            currency: "USD",
            cancel_policy: "FAKE: cancel in Settings.",
            cancel_url: `https://www.${service_domain}/settings/billing`,
            source_urls: [`https://www.${service_domain}/pricing`],
          },
        };
      },
    }
  : env["EXA_API_KEY"]
    ? createTermsLookup({ client: createExaClient(env["EXA_API_KEY"]) })
    : { lookupTerms: async () => ({ ok: false as const, reason: "EXA_API_KEY is not set" }) };

const canceller: Canceller = fake
  ? {
      async cancel() {
        return { outcome: "cancelled", detail: "FAKE: subscription cancelled.", live_view_url: "https://live.example/fake", replay_url: null };
      },
      cancelMany: async () => [],
    }
  : env["KERNEL_API_KEY"]
    ? createCanceller({
        kernel: createKernelApi(env["KERNEL_API_KEY"]),
        ...(env["KERNEL_PROFILE"] ? { profileName: env["KERNEL_PROFILE"] } : {}),
        hooks: { log },
      })
    : {
        async cancel() {
          return { outcome: "failed", detail: "KERNEL_API_KEY is not set, nothing was attempted", live_view_url: null, replay_url: null };
        },
        cancelMany: async () => [],
      };
if (fake) log({ msg: "FAKE MODE: terms and cancels are simulated" });

// ---- wire it up ----------------------------------------------------------------------------
const approval = createApprovalService({ db });
const agent = createAgent({ db, approval, terms, canceller, log });
const inbox = createInboxHandler({ verify: createVerifier(webhookSecret), emit: agent.emit, log });

const sweepEvery = Number(env["SWEEP_INTERVAL_MS"] ?? 30_000);
const sweep = () => agent.sweep().then((r) => log({ msg: "sweep", ...r }), (e) => log({ msg: "sweep.failed", error: String(e) }));
void sweep();
setInterval(sweep, sweepEvery).unref();

// ---- dev approval endpoints ----------------------------------------------------------------
const devToken = env["DEV_APPROVAL_TOKEN"];
function tokenOk(request: Request): boolean {
  if (!devToken) return false;
  const given = Buffer.from(request.headers.get("x-dev-token") ?? "");
  const wanted = Buffer.from(devToken);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/health") return json({ ok: true, fake });

  if (pathname === "/approvals" || pathname === "/positions" || pathname.startsWith("/approvals/")) {
    if (!devToken) return json({ error: "dev approval endpoints are disabled (set DEV_APPROVAL_TOKEN)" }, 404);
    if (!tokenOk(request)) return json({ error: "unauthorized" }, 401);
    if (pathname === "/positions" && request.method === "GET") return json(await db.listPositions());
    if (pathname === "/approvals" && request.method === "GET") return json(await approval.listPending());
    const match = /^\/approvals\/([^/]+)\/(approve|decline)$/.exec(pathname);
    if (match && request.method === "POST") {
      try {
        const decision = match[2] === "approve" ? "approved" : "declined";
        const { position } = await approval.resolveApproval(match[1]!, decision, { via: "http-dev" });
        return json({ ok: true, decision, position_status: position.status });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
    }
    return json({ error: "not found" }, 404);
  }
  return inbox(request); // anything else is treated as the AgentMail webhook
}

const port = Number(env["PORT"] ?? 8787);
createServer(async (req, res) => {
  await sendWebResponse(res, await route(await toWebRequest(req)));
}).listen(port, () => log({ msg: "listening", url: `http://localhost:${port}`, dev_approvals: Boolean(devToken) }));
