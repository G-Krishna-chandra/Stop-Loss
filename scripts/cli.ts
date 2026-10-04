// Dev CLI. Resolves approvals and inspects state without any user-facing surface.
//   npm run cli -- positions
//   npm run cli -- approvals
//   npm run cli -- approve <approval-id>
//   npm run cli -- decline <approval-id>
//   npm run cli -- open <service-name> <domain> <signup-email>
//   npm run cli -- ff <position-id> [hours]     fast-forward renewal for the demo
//   npm run cli -- exposure
//   npm run cli -- reopen <position-id>         demo only: put a kept/failed position back to open
//   npm run cli -- events <position-id>        timeline for one position
//   npm run cli -- inbox [n]                    latest emails in the StopLoss inbox
//   npm run cli -- read [n]                     full text of the nth latest email (1 = newest)
//   npm run cli -- connect <domain> [login-url]  Kernel Managed Auth: enter the password once on Kernel's page; Kernel signs in from then on
//   npm run cli -- login <domain> [url]          open a Kernel browser on the service's profile to log in once
//   npm run cli -- login-done <session-id>       close it, which saves the login to the profile
//   npm run cli -- stop-check                  run the scheduled stop check now
// approve, decline and stop-check need the server running (npm run dev).
import 'dotenv/config';
import { AgentMailClient } from 'agentmail';
import * as db from '../src/db/index.js';
import { closeLoginSession, connect, openLoginSession, waitForConnection } from '../src/cancel/index.js';

const [cmd, ...args] = process.argv.slice(2);

function server(path: string, payload: unknown): Promise<Response> {
  const base = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.ADMIN_TOKEN ?? ''}` },
    body: JSON.stringify(payload),
  });
}

function need(value: string | undefined, name: string): string {
  if (!value) {
    console.error(`Missing <${name}>.`);
    process.exit(1);
  }
  return value;
}

switch (cmd) {
  case 'positions':
    console.table(
      (await db.listPositions()).map((p) => ({
        id: p.id,
        service: p.service_name,
        status: p.status,
        renews: p.renewal_date?.toISOString() ?? '-',
        price: p.renewal_price_cents != null ? `${p.renewal_price_cents / 100} ${p.currency}` : '-',
      })),
    );
    break;
  case 'approvals':
    console.table(await db.listPendingApprovals());
    break;
  case 'approve':
  case 'decline': {
    // Goes through the running server, which owns the suspended workflow and resumes it.
    const res = await server(`/approvals/${need(args[0], 'approval-id')}`, {
      decision: cmd === 'approve' ? 'approved' : 'declined',
    });
    console.log(res.status, await res.text());
    break;
  }
  case 'stop-check': {
    const res = await server('/stop-check', {});
    console.log(res.status, await res.text());
    break;
  }
  case 'open': {
    const { position, created } = await db.openPosition({
      service_name: need(args[0], 'service-name'),
      service_domain: need(args[1], 'domain'),
      signup_email: need(args[2], 'signup-email'),
    });
    console.log(created ? 'Opened' : 'Already open', position);
    break;
  }
  case 'ff': {
    const p = await db.fastForward(need(args[0], 'position-id'), Number(args[1] ?? 24));
    console.log(p ? `Renewal moved to ${p.renewal_date?.toISOString()}` : 'Position not found.');
    break;
  }
  case 'reopen': {
    const p = await db.reopen(need(args[0], 'position-id'));
    console.log(p ? `Reopened ${p.service_name}.` : 'Only kept or failed positions can be reopened.');
    break;
  }
  case 'exposure':
    console.table(await db.exposure());
    break;
  case 'events':
    for (const e of await db.listEvents(need(args[0], 'position-id'))) {
      console.log(e.created_at.toISOString().slice(11, 19), e.type.padEnd(18), JSON.stringify(e.payload).slice(0, 300));
    }
    break;
  case 'inbox': {
    const am = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY! });
    const inboxId = process.env.AGENTMAIL_INBOX_ID!;
    const { messages } = await am.inboxes.messages.list(inboxId, { limit: Number(args[0] ?? 10) });
    console.log(`Inbox ${inboxId}`);
    for (const m of messages) {
      console.log(`${new Date(m.timestamp).toISOString().slice(0, 16)}  ${m.labels.includes('sent') ? 'OUT' : 'IN '}  ${m.from.padEnd(45).slice(0, 45)}  ${m.subject ?? ''}`);
    }
    break;
  }
  case 'read': {
    const am = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY! });
    const inboxId = process.env.AGENTMAIL_INBOX_ID!;
    const n = Number(args[0] ?? 1);
    const { messages } = await am.inboxes.messages.list(inboxId, { limit: n });
    const m = messages[n - 1];
    if (!m) {
      console.log('No such message.');
      break;
    }
    const full = await am.inboxes.messages.get(inboxId, m.messageId);
    console.log(`From: ${full.from}\nSubject: ${full.subject ?? ''}\nDate: ${full.timestamp}\n`);
    console.log(full.text ?? full.extractedText ?? (full.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    break;
  }
  case 'connect': {
    const domain = need(args[0], 'domain');
    const c = await connect(domain, args[1]);
    console.log(`Log in once on Kernel's page (the password goes to Kernel, never to StopLoss):\n${c.hosted_url}`);
    console.log('Waiting up to 10 minutes...');
    const status = await waitForConnection(c.id, 10 * 60 * 1000);
    console.log(status === 'AUTHENTICATED' ? `Connected. Kernel will keep ${domain} signed in.` : `Not connected yet (${status}). Run connect again.`);
    break;
  }
  case 'login': {
    const domain = need(args[0], 'domain');
    const b = await openLoginSession(domain, args[1] ?? `https://${domain}/login`);
    console.log(`Log in here (live view): ${b.browser_live_view_url}`);
    console.log(`When done: npm run cli -- login-done ${b.session_id}`);
    break;
  }
  case 'login-done':
    await closeLoginSession(need(args[0], 'session-id'));
    console.log('Saved. The cancel flow for this service will start logged in.');
    break;
  default:
    console.log('Commands: connect <domain> [login-url] | login <domain> [url] | login-done <id> | inbox [n] | read [n] | positions | approvals | approve <id> | decline <id> | open <name> <domain> <email> | ff <id> [hours] | reopen <id> | exposure | events <id> | stop-check');
}
