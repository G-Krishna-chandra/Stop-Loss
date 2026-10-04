// Applies src/db/schema.sql. Run with `npm run db:migrate`. Uses DATABASE_URL_UNPOOLED when set (Neon recommends a
// direct connection for migrations), else DATABASE_URL.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add your Neon connection string to .env.local.");
  process.exit(1);
}

const sql = neon(url);
const statements = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8")
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
}
console.log(`Applied ${statements.length} statements.`);
