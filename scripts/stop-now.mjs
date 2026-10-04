// Demo helper: moves a position's stop to now, so the next stop check (npm run inbox:listen, every minute) asks you.
//   npm run stop:now            lists open positions
//   npm run stop:now -- <id>    sets that position's stop to now and runs the stop check
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const id = process.argv[2];
if (!id) {
  const rows = await sql`select id, service_name, status, stop_at from positions where status = 'open' order by opened_at`;
  if (rows.length === 0) console.log("No open positions.");
  for (const r of rows) console.log(`${r.id}  ${r.service_name}  stop ${r.stop_at ? new Date(r.stop_at).toLocaleString() : "not set"}`);
  process.exit(0);
}

const rows = await sql`update positions set stop_at = now() where id = ${id} and status = 'open' returning service_name`;
if (rows.length === 0) {
  console.error("No open position with that id.");
  process.exit(1);
}
const base = process.env.STOPLOSS_URL || "http://localhost:3000";
const res = await fetch(`${base}/api/cron/stops`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
console.log(`${rows[0].service_name}: stop moved to now. Stop check ->`, res.status, await res.json().catch(() => ({})));
