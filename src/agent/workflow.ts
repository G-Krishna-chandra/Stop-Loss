// The stop workflow: arm -> wait for approval -> cancel -> (retention offer? wait again) -> record.
// There is no path to a cancel that skips a human approval.
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import * as db from '../db/index.js';
import { requestApproval } from '../approval/index.js';
import type { CancelResult, Position } from '../types.js';

export interface WorkflowDeps {
  cancel(position: Position, opts: { declineRetentionOffer?: boolean }): Promise<CancelResult>;
}

let deps: WorkflowDeps | null = null;
export function setWorkflowDeps(d: WorkflowDeps): void {
  deps = d;
}
function need(): WorkflowDeps {
  if (!deps) throw new Error('Workflow deps not configured. Call setWorkflowDeps first.');
  return deps;
}

const Flow = z.object({
  position_id: z.string(),
  status: z.enum(['continue', 'done']),
  note: z.string(),
});
type Flow = z.infer<typeof Flow>;

const Decision = z.object({ decision: z.enum(['approved', 'declined']) });
const Waiting = z.object({ approval_id: z.string(), detail: z.string() });

const done = (position_id: string, note: string): Flow => ({ position_id, status: 'done', note });

const arm = createStep({
  id: 'arm',
  inputSchema: z.object({ position_id: z.string(), run_id: z.string().optional() }),
  outputSchema: Flow,
  execute: async ({ inputData, runId }) => {
    const p = await db.transition(inputData.position_id, 'stop_pending');
    if (!p) return done(inputData.position_id, 'Position was not open; stop not armed.');
    await db.addEvent(p.id, 'stop_armed', { run_id: runId, renewal_date: p.renewal_date });
    return { position_id: p.id, status: 'continue' as const, note: 'armed' };
  },
});

const awaitApproval = createStep({
  id: 'await-approval',
  inputSchema: Flow,
  outputSchema: Flow,
  resumeSchema: Decision,
  suspendSchema: Waiting,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (inputData.status === 'done') return inputData;
    const p = await db.getPosition(inputData.position_id);
    if (!p) return done(inputData.position_id, 'Position disappeared.');

    if (!resumeData) {
      const approvalId = await requestApproval(p, 'cancel');
      console.log(`[agent] approval needed for ${p.service_name}: npm run cli -- approve ${approvalId}`);
      return await suspend({ approval_id: approvalId, detail: `Cancel ${p.service_name}?` });
    }
    if (resumeData.decision === 'declined') {
      await db.transition(p.id, 'kept');
      await db.addEvent(p.id, 'kept', { reason: 'Human declined the cancel.' });
      return done(p.id, 'kept');
    }
    if (!(await db.transition(p.id, 'approved'))) return done(p.id, `Could not approve from status ${p.status}.`);
    return { position_id: p.id, status: 'continue' as const, note: 'approved' };
  },
});

const runCancel = async (positionId: string, declineRetentionOffer: boolean): Promise<CancelResult> => {
  const p = await db.getPosition(positionId);
  if (!p) return { outcome: 'failed', detail: 'Position disappeared.', live_view_url: null, replay_url: null };
  await db.addEvent(p.id, 'cancel_started', { decline_retention_offer: declineRetentionOffer });
  const r = await need().cancel(p, { declineRetentionOffer });
  await db.addEvent(p.id, 'cancel_result', { ...r });
  return r;
};

const cancelStep = createStep({
  id: 'cancel',
  inputSchema: Flow,
  outputSchema: Flow.extend({ outcome: z.string().optional() }),
  execute: async ({ inputData }) => {
    if (inputData.status === 'done') return inputData;
    if (!(await db.transition(inputData.position_id, 'cancelling'))) {
      return done(inputData.position_id, 'Position was not approved; refusing to cancel.');
    }
    const r = await runCancel(inputData.position_id, false);
    return { ...inputData, outcome: r.outcome, note: r.detail };
  },
});

const retention = createStep({
  id: 'retention-offer',
  inputSchema: Flow.extend({ outcome: z.string().optional() }),
  outputSchema: Flow.extend({ outcome: z.string().optional() }),
  resumeSchema: Decision,
  suspendSchema: Waiting,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (inputData.status === 'done' || inputData.outcome !== 'retention_offer') return inputData;
    const p = await db.getPosition(inputData.position_id);
    if (!p) return done(inputData.position_id, 'Position disappeared.');

    if (!resumeData) {
      const detail = `${p.service_name} offered something to keep you: "${inputData.note}". Cancel anyway?`;
      const approvalId = await requestApproval(p, 'retention_offer', detail);
      console.log(`[agent] retention offer on ${p.service_name}: npm run cli -- approve ${approvalId}`);
      return await suspend({ approval_id: approvalId, detail });
    }
    if (resumeData.decision === 'declined') {
      await db.fail(p.id, 'Retention offer shown; you chose not to cancel. Accept the offer yourself in the account if you want it.');
      return done(p.id, 'kept at retention offer');
    }
    const r = await runCancel(p.id, true);
    return { ...inputData, outcome: r.outcome, note: r.detail };
  },
});

const record = createStep({
  id: 'record',
  inputSchema: Flow.extend({ outcome: z.string().optional() }),
  outputSchema: Flow,
  execute: async ({ inputData }) => {
    const { position_id, outcome, note } = inputData;
    if (inputData.status === 'done') return done(position_id, note);
    if (outcome === 'cancelled' && note.startsWith('No charge coming:')) {
      // Nothing to cancel: the account itself shows the trial ends free. The evidence is that page (see replay).
      const p = await db.transition(position_id, 'closed');
      if (p) await db.addEvent(position_id, 'closed', { evidence: 'account_page', detail: note });
      return done(position_id, note);
    }
    if (outcome === 'cancelled') {
      // Stay in 'cancelling' until the cancellation email arrives. The email closes the position.
      return done(position_id, `Cancelled in the account; waiting for the confirmation email. ${note}`);
    }
    // needs_login, failed, or a second retention offer: surface it, never retry.
    await db.fail(position_id, `${outcome ?? 'unknown'}: ${note}`);
    return done(position_id, note);
  },
});

export const stopWorkflow = createWorkflow({
  id: 'stop',
  inputSchema: z.object({ position_id: z.string() }),
  outputSchema: Flow,
})
  .then(arm)
  .then(awaitApproval)
  .then(cancelStep)
  .then(retention)
  .then(record)
  .commit();

export const STEP_FOR_KIND = { cancel: 'await-approval', retention_offer: 'retention-offer' } as const;
