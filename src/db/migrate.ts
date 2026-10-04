import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { sql } from './client.js';

const ddl = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
const statements = ddl
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);

for (const stmt of statements) {
  await sql().query(stmt);
}
console.log(`Applied ${statements.length} statements.`);
