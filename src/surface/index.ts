// The user-facing surface: one web page served by the StopLoss server, plus the JSON it calls.
// Decisions go through src/approval only. Everything except GET / needs the ADMIN_TOKEN bearer.
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as db from '../db/index.js';
import { resolveApproval } from '../approval/index.js';
import { PAGE } from './page.js';

export interface SurfaceDeps {
  checkStops(): Promise<void>;
  liveViews: Map<string, string>; // position id -> Kernel live view URL while a cancel runs
  inboxAddress: string;
}

type Send = (res: ServerResponse, status: number, payload: unknown) => void;

/** Returns true if it handled the request. */
export async function handleSurface(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: SurfaceDeps,
  send: Send,
  readBody: () => Promise<string>,
): Promise<boolean> {
  const { method } = req;
  const path = url.pathname;

  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
    return true;
  }
  if (!path.startsWith('/api/')) return false;

  if (method === 'GET' && path === '/api/state') {
    const [positions, approvals, exposure] = await Promise.all([
      db.listPositions(),
      db.listPendingApprovals(),
      db.exposure(),
    ]);
    send(res, 200, {
      inbox: deps.inboxAddress,
      positions,
      approvals,
      exposure,
      live_views: Object.fromEntries(deps.liveViews),
    });
    return true;
  }

  let m = path.match(/^\/api\/positions\/([0-9a-f-]{36})\/events$/);
  if (method === 'GET' && m) {
    send(res, 200, await db.listEvents(m[1]!));
    return true;
  }

  m = path.match(/^\/api\/approvals\/([0-9a-f-]{36})$/);
  if (method === 'POST' && m) {
    const { decision } = JSON.parse((await readBody()) || '{}') as { decision?: string };
    if (decision !== 'approved' && decision !== 'declined') {
      send(res, 400, { error: 'decision must be approved or declined' });
      return true;
    }
    try {
      send(res, 200, await resolveApproval(m[1]!, decision));
    } catch (err) {
      send(res, 409, { error: (err as Error).message });
    }
    return true;
  }

  // Demo controls.
  m = path.match(/^\/api\/positions\/([0-9a-f-]{36})\/fast-forward$/);
  if (method === 'POST' && m) {
    const p = await db.fastForward(m[1]!, 24);
    if (p) await deps.checkStops();
    send(res, p ? 200 : 404, p ?? { error: 'not found' });
    return true;
  }
  m = path.match(/^\/api\/positions\/([0-9a-f-]{36})\/reopen$/);
  if (method === 'POST' && m) {
    const p = await db.reopen(m[1]!);
    send(res, p ? 200 : 409, p ?? { error: 'Only kept or failed positions can be reopened.' });
    return true;
  }
  if (method === 'POST' && path === '/api/stop-check') {
    await deps.checkStops();
    send(res, 200, { ok: true });
    return true;
  }

  send(res, 404, { error: 'not found' });
  return true;
}
