// Creates the StopLoss inbox (idempotent) and writes AGENTMAIL_INBOX_ID to .env.
//   npm run setup:inbox -- [username]
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { ensureInbox } from '../src/inbox/index.js';

if (process.argv[2]) process.env.AGENTMAIL_USERNAME = process.argv[2];
delete process.env.AGENTMAIL_INBOX_ID;

const inboxId = await ensureInbox();
const env = await readFile('.env', 'utf8').catch(() => '');
const line = `AGENTMAIL_INBOX_ID=${inboxId}`;
await writeFile(
  '.env',
  /^AGENTMAIL_INBOX_ID=.*$/m.test(env) ? env.replace(/^AGENTMAIL_INBOX_ID=.*$/m, line) : `${env.trimEnd()}\n${line}\n`,
);
console.log(`StopLoss address: ${inboxId}`);
