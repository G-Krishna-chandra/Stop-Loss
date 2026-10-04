// The approval interface. Any user-facing surface calls resolveApproval and nothing else.
// No UI code lives here, and nothing here knows which surface exists.
import * as db from '../db/index.js';
import type { ApprovalDecision, ApprovalKind, ApprovalRequest, Position } from '../types.js';

export type ApprovalListener = (request: ApprovalRequest) => Promise<void> | void;

const listeners: ApprovalListener[] = [];

/** The agent registers here to resume its workflow when a human decides. */
export function onApprovalResolved(listener: ApprovalListener): void {
  listeners.push(listener);
}

/** Creates a pending ApprovalRequest and returns its id. Idempotent per position and kind. */
export async function requestApproval(
  position: Position,
  kind: ApprovalKind = 'cancel',
  detail: string = defaultDetail(position),
): Promise<string> {
  const request = await db.createApproval(position.id, kind, detail);
  await db.addEvent(position.id, 'approval_requested', { approval_id: request.id, kind, detail });
  return request.id;
}

/** Records the decision and resumes the workflow. Throws if the request is unknown or already resolved. */
export async function resolveApproval(id: string, decision: ApprovalDecision): Promise<ApprovalRequest> {
  const request = await db.resolveApprovalRow(id, decision);
  if (!request) {
    const existing = await db.getApproval(id);
    throw new Error(existing ? `Approval ${id} is already ${existing.status}.` : `Approval ${id} not found.`);
  }
  await db.addEvent(request.position_id, 'approval_resolved', {
    approval_id: id,
    kind: request.kind,
    decision,
  });
  for (const listener of listeners) await listener(request);
  return request;
}

function defaultDetail(p: Position): string {
  const price =
    p.renewal_price_cents != null
      ? `${(p.renewal_price_cents / 100).toFixed(2)} ${p.currency ?? 'USD'}`
      : 'an unknown price';
  const when = p.renewal_date ? p.renewal_date.toISOString().slice(0, 10) : 'soon';
  return `${p.service_name} renews ${when} for ${price}. Cancel?`;
}
