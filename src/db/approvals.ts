import type { ApprovalKind, ApprovalRequest, ApprovalStatus } from "@/types";
import { iso, sql } from "./client";

type Row = Record<string, unknown>;

function toApproval(r: Row): ApprovalRequest {
  return {
    id: String(r.id),
    position_id: String(r.position_id),
    kind: r.kind as ApprovalKind,
    detail: (r.detail as string | null) ?? null,
    status: r.status as ApprovalStatus,
    workflow_run_id: (r.workflow_run_id as string | null) ?? null,
    created_at: iso(r.created_at) ?? "",
    resolved_at: iso(r.resolved_at),
  };
}

// Creates a pending request, or returns the pending one of the same kind that already exists.
export async function createPendingApproval(
  positionId: string,
  kind: ApprovalKind,
  detail: string | null,
  workflowRunId: string | null = null,
): Promise<ApprovalRequest> {
  const rows = await sql()`
    insert into approval_requests (position_id, kind, detail, workflow_run_id)
    values (${positionId}, ${kind}, ${detail}, ${workflowRunId})
    on conflict (position_id, kind) where status = 'pending' do nothing
    returning *`;
  if (rows[0]) return toApproval(rows[0]);
  const existing = await sql()`
    select * from approval_requests where position_id = ${positionId} and kind = ${kind} and status = 'pending'`;
  return toApproval(existing[0]);
}

export async function getApproval(id: string): Promise<ApprovalRequest | null> {
  const rows = await sql()`select * from approval_requests where id = ${id}`;
  return rows[0] ? toApproval(rows[0]) : null;
}

export async function listPendingApprovals(): Promise<ApprovalRequest[]> {
  const rows = await sql()`select * from approval_requests where status = 'pending' order by created_at asc`;
  return rows.map(toApproval);
}

export async function pendingApprovalFor(positionId: string): Promise<ApprovalRequest | null> {
  const rows = await sql()`
    select * from approval_requests where position_id = ${positionId} and status = 'pending'
    order by created_at desc limit 1`;
  return rows[0] ? toApproval(rows[0]) : null;
}

// Records a decision once. Returns null if the request was already resolved.
export async function decideApproval(id: string, status: "approved" | "declined"): Promise<ApprovalRequest | null> {
  const rows = await sql()`
    update approval_requests set status = ${status}, resolved_at = now()
    where id = ${id} and status = 'pending'
    returning *`;
  return rows[0] ? toApproval(rows[0]) : null;
}

export async function setApprovalRun(id: string, workflowRunId: string): Promise<void> {
  await sql()`update approval_requests set workflow_run_id = ${workflowRunId} where id = ${id}`;
}
