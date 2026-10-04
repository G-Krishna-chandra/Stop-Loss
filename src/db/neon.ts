import { neon } from "@neondatabase/serverless";
import type { Db, DbOptions } from "./contract.js";
import { createPostgresDb, type Row, type SqlRunner } from "./postgres.js";

// The only file that knows Neon exists. Exact call from the Neon serverless driver docs:
//   const sql = neon(url);  const rows = await sql.query("SELECT ... $1", [value]);
// `neon()` is the stateless HTTP driver: one request per statement, no interactive transactions,
// which is why src/db/postgres.ts makes every atomic operation a single statement.

export function createNeonRunner(databaseUrl: string): SqlRunner {
  const sql = neon(databaseUrl);
  return async (text, params = []) => (await sql.query(text, params)) as Row[];
}

export function createNeonDb(databaseUrl: string, options?: DbOptions): Db {
  return createPostgresDb(createNeonRunner(databaseUrl), options);
}
