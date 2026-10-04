// The StopLoss agent. Everything here is autonomous except the one human approval per cancel.
import { Mastra } from '@mastra/core/mastra';
import { PostgresStore } from '@mastra/pg';
import * as db from '../db/index.js';
import { onApprovalResolved } from '../approval/index.js';
import type { ApprovalRequest, CancelResult, InboxEmail, Position, Terms } from '../types.js';
import { STEP_FOR_KIND, setWorkflowDeps, stopWorkflow } from './workflow.js';

/** Everything the agent needs from other modules, injected by the entry point. */
export interface AgentDeps {
  lookupTerms(serviceName: string, domain: string, emailText: string): Promise<Terms>;
  getMessageText(inboxId: string, messageId: string): Promise<string>;
  cancel(position: Position, opts: { declineRetentionOffer?: boolean }, login: LoginWaiter): Promise<CancelResult>;
  rehearse?(position: Position, login: LoginWaiter): Promise<{ ok: boolean; detail: string }>;
}

export type LoginWaiter = (
  domain: string,
  since: Date,
  timeoutMs: number,
) => Promise<{ code: string | null; link: string | null } | null>;

export const STOP_LEAD_HOURS = Number(process.env.STOP_LEAD_HOURS ?? 48);

let mastra: Mastra;
let deps: AgentDeps;

export function startAgent(d: AgentDeps): Mastra {
  deps = d;
  mastra = new Mastra({
    workflows: { stop: stopWorkflow },
    storage: new PostgresStore({ id: 'stoploss-storage', connectionString: process.env.DATABASE_URL! }),
  });
  setWorkflowDeps({ cancel: (p, opts) => deps.cancel(p, opts, waitForLogin) });
  onApprovalResolved(resumeFromApproval);
  return mastra;
}

// ---------- stops ----------

/** Starts the stop workflow for a position. Safe to call twice: arming is an atomic status change. */
export async function startStop(positionId: string): Promise<void> {
  const run = await mastra.getWorkflow('stop').createRun();
  const result = await run.start({ inputData: { position_id: positionId } });
  console.log(`[agent] stop ${positionId}: ${result.status}`);
}

/** The scheduled stop check. Arms every open position whose renewal is within the lead time. */
export async function checkStops(): Promise<void> {
  const due = await db.dueForStop(STOP_LEAD_HOURS);
  // Positions arm in parallel; each waits for its own approval.
  await Promise.all(due.map((p) => startStop(p.id).catch((err) => console.error('[agent] stop failed', p.id, err))));
}

async function resumeFromApproval(request: ApprovalRequest): Promise<void> {
  const armed = (await db.listEvents(request.position_id)).filter((e) => e.type === 'stop_armed').at(-1);
  const runId = armed?.payload.run_id;
  if (typeof runId !== 'string') {
    console.error(`[agent] no workflow run for position ${request.position_id}`);
    return;
  }
  const run = await mastra.getWorkflow('stop').createRun({ runId });
  // Don't block the caller (an HTTP request or CLI) on a browser session.
  void run
    .resume({ step: STEP_FOR_KIND[request.kind], resumeData: { decision: request.status as 'approved' | 'declined' } })
    .then((r) => console.log(`[agent] resumed ${request.position_id}: ${r.status}`))
    .catch((err) => console.error('[agent] resume failed', err));
}

// ---------- inbox ----------

const loginWaiters: { domain: string; since: Date; resolve: (s: { code: string | null; link: string | null }) => void }[] = [];

/** Resolves with the next login code or link for this domain. Held in memory only. */
export const waitForLogin: LoginWaiter = (domain, since, timeoutMs) =>
  new Promise((resolve) => {
    const waiter = { domain, since, resolve: (s: { code: string | null; link: string | null }) => resolve(s) };
    loginWaiters.push(waiter);
    setTimeout(() => {
      const i = loginWaiters.indexOf(waiter);
      if (i >= 0) {
        loginWaiters.splice(i, 1);
        resolve(null);
      }
    }, timeoutMs);
  });

export async function handleInboxEmail(email: InboxEmail): Promise<void> {
  switch (email.kind) {
    case 'welcome': {
      if (!email.position_id) return;
      const p = await db.getPosition(email.position_id);
      // Only onboard a fresh position; a repeat welcome must not reset terms or the renewal date.
      if (p?.status === 'open' && p.renewal_date == null) await onboard(email);
      return;
    }

    case 'login_code': {
      // Match by sender domain. Many sites send codes from an auth provider's domain instead, so when exactly
      // one login is waiting, a code that arrived after it started goes to it. A wrong code just fails to log in.
      const fresh = loginWaiters.filter((w) => email.received_at >= w.since);
      const match = fresh.find((w) => w.domain === email.service_domain) ?? (fresh.length === 1 ? fresh[0] : undefined);
      const i = match ? loginWaiters.indexOf(match) : -1;
      if (i >= 0 && (email.login_code || email.magic_link)) {
        loginWaiters.splice(i, 1)[0]!.resolve({ code: email.login_code, link: email.magic_link });
      }
      return;
    }

    case 'trial_ending': {
      // A real "trial ending" email beats the schedule: arm the stop now.
      if (!email.position_id) return;
      const p = await db.getPosition(email.position_id);
      if (p?.status === 'open') await startStop(p.id);
      return;
    }

    case 'cancellation': {
      if (!email.position_id) return;
      const p = await db.transition(email.position_id, 'closed', { evidence_email_id: email.message_id });
      if (p) {
        await db.addEvent(p.id, 'closed', { evidence_email_id: email.message_id, subject: email.subject });
        console.log(`[agent] closed ${p.service_name} with email proof`);
      }
      return;
    }

    default:
      return;
  }
}

/** Reads the terms and sets the stop. Optionally rehearses the cancel path ahead of time. */
async function onboard(email: InboxEmail): Promise<void> {
  const positionId = email.position_id!;
  try {
    const text = await deps.getMessageText(email.inbox_id, email.message_id);
    const terms = await deps.lookupTerms(email.service_name, email.service_domain, text);
    const p = await db.getPosition(positionId);
    if (!p) return;
    const renewal =
      terms.trial_days != null ? new Date(p.opened_at.getTime() + terms.trial_days * 24 * 60 * 60 * 1000) : null;
    const updated = await db.applyTerms(positionId, {
      renewal_date: renewal,
      renewal_price_cents: terms.renewal_price_cents,
      currency: terms.currency,
      cancel_url: terms.cancel_url,
    });
    await db.addEvent(positionId, 'terms_found', { ...terms });
    console.log(
      `[agent] ${email.service_name}: ${terms.trial_days ?? '?'}-day trial, renews ${renewal?.toISOString() ?? 'unknown'} for ${terms.renewal_price_cents ?? '?'} ${terms.currency ?? ''}`,
    );
    if (updated && deps.rehearse && process.env.REHEARSE === '1') {
      const r = await deps.rehearse(updated, waitForLogin);
      await db.addEvent(positionId, 'cancel_result', { rehearsal: true, ok: r.ok, detail: r.detail });
    }
  } catch (err) {
    // Terms are best-effort; the position stays open and can be fixed by hand.
    console.error(`[agent] onboarding ${email.service_domain} failed`, err);
    await db.addEvent(positionId, 'terms_found', { error: (err as Error).message });
  }
}
