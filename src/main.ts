// Entry point: wires the modules together and runs the server, inbox listener, and stop check.
import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import * as db from './db/index.js';
import * as inbox from './inbox/index.js';
import { lookupTerms } from './terms/index.js';
import { cancel, rehearse } from './cancel/index.js';
import { checkStops, handleInboxEmail, startAgent } from './agent/index.js';
import { resolveApproval } from './approval/index.js';
import { handleSurface } from './surface/index.js';

const PORT = Number(process.env.PORT ?? 3000);
const CHECK_EVERY_MS = Number(process.env.STOP_CHECK_SECONDS ?? 60) * 1000;

const liveViews = new Map<string, string>();

startAgent({
  lookupTerms,
  getMessageText: inbox.getMessageText,
  cancel: async (position, opts, waitForLogin) => {
    const onLiveView = (url: string) => {
      liveViews.set(position.id, url);
      console.log(`[cancel] ${position.service_name} live view: ${url}`);
    };
    try {
      return await cancel(position, { waitForLogin, onLiveView }, opts);
    } finally {
      liveViews.delete(position.id);
    }
  },
  rehearse: (position, waitForLogin) => rehearse(position, { waitForLogin }),
});
inbox.onInboxEmail(handleInboxEmail);

const inboxId = await inbox.ensureInbox();
const startedAt = new Date();
if (!process.env.AGENTMAIL_WEBHOOK_SECRET) await inbox.listen(inboxId);
inbox.poll(inboxId, startedAt);

setInterval(() => void checkStops().catch((err) => console.error('[stop-check]', err)), CHECK_EVERY_MS);
void checkStops().catch((err) => console.error('[stop-check]', err));

createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error('[http]', err);
    send(res, 500, { error: 'internal error' });
  });
}).listen(PORT, () => {
  console.log(`[http] listening on :${PORT}. StopLoss address: ${inboxId}`);
  if (process.env.ADMIN_TOKEN) console.log(`[surface] open http://localhost:${PORT}/#token=${process.env.ADMIN_TOKEN}`);
});

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

  // The page itself is public (it holds no data); its /api calls need the token.
  if (url.pathname.startsWith('/api/') && !authorized(req)) return send(res, 401, { error: 'unauthorized' });
  if (await handleSurface(req, res, url, { checkStops, liveViews, inboxAddress: inboxId }, send, () => body(req))) return;

  if (req.method === 'POST' && url.pathname === '/webhooks/agentmail') {
    const status = await inbox.handleWebhook(await body(req), headers(req));
    res.writeHead(status).end();
    return;
  }

  // Everything below is the dev surface: CLI and demo only, behind a bearer token.
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && url.pathname === '/state') {
    const [positions, approvals, exposure] = await Promise.all([db.listPositions(), db.listPendingApprovals(), db.exposure()]);
    return send(res, 200, { positions, approvals, exposure });
  }

  const m = url.pathname.match(/^\/approvals\/([0-9a-f-]{36})$/);
  if (req.method === 'POST' && m) {
    const { decision } = JSON.parse((await body(req)) || '{}') as { decision?: string };
    if (decision !== 'approved' && decision !== 'declined') return send(res, 400, { error: 'decision must be approved or declined' });
    try {
      return send(res, 200, await resolveApproval(m[1]!, decision));
    } catch (err) {
      return send(res, 409, { error: (err as Error).message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/stop-check') {
    await checkStops();
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'not found' });
}

function authorized(req: IncomingMessage): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

function headers(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')]));
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
      if (data.length > 2_000_000) req.destroy(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
}
