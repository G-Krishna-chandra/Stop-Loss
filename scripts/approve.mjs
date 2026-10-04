// CLI approvals for development (skill section 3). It calls the same HTTP endpoint the UI uses.
//   npm run approve -- list
//   npm run approve -- <approval-id> approve|decline
const base = process.env.STOPLOSS_URL || "http://localhost:3000";
const [id, decision] = process.argv.slice(2);

if (!id || id === "list") {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    select a.id, a.kind, a.detail, p.service_name from approval_requests a join positions p on p.id = a.position_id
    where a.status = 'pending' order by a.created_at`;
  if (rows.length === 0) console.log("No pending approvals.");
  for (const r of rows) console.log(`${r.id}  ${r.kind.padEnd(15)}  ${r.service_name}: ${r.detail ?? ""}`);
  process.exit(0);
}

if (decision !== "approve" && decision !== "decline") {
  console.error("Usage: npm run approve -- <approval-id> approve|decline");
  process.exit(1);
}

const res = await fetch(`${base}/api/approvals/${id}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ decision }),
});
const body = await res.json().catch(() => ({}));
console.log(res.status, body);
if (body.runId) console.log(`Watch it: ${base}/runs/${body.runId}`);
process.exit(res.ok ? 0 : 1);
