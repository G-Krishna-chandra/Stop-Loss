// Dev-only way to resolve approvals from a terminal (stop-loss skill, section 3: "for development
// and testing, resolve approvals with a CLI script"). This is NOT the product's user surface.
//
//   npm run approvals -- list
//   npm run approvals -- approve <id>
//   npm run approvals -- decline <id>
//
// Talks to the Neon database in DATABASE_URL. Note: this records and applies the decision, but
// the resume callback (src/agent's onResolved handler) only exists inside the agent's own
// process. Until src/agent decides how a suspended workflow wakes up (poll the database, or host
// an endpoint in the agent process), a decision made here is saved but not yet acted on.
import { createApprovalService } from "../src/approval/index.js";
import { createNeonDb } from "../src/db/index.js";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const service = createApprovalService({ db: createNeonDb(url) });
const [command, id] = process.argv.slice(2);

if (command === "list") {
  const pending = await service.listPending();
  if (pending.length === 0) console.log("no pending approvals");
  for (const { approval, position } of pending) {
    console.log(`${approval.id}  [${approval.kind}]  ${approval.detail}`);
    console.log(`    position ${position.id} (${position.status}), renews ${position.renewal_date ?? "unknown"}`);
  }
} else if ((command === "approve" || command === "decline") && id) {
  const decision = command === "approve" ? "approved" : "declined";
  const { position } = await service.resolveApproval(id, decision, { via: "cli" });
  console.log(`${decision}. position ${position.id} is now ${position.status}`);
} else {
  console.error("usage: npm run approvals -- list | approve <id> | decline <id>");
  process.exit(1);
}
