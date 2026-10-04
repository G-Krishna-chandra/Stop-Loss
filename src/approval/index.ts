// The one approval interface (skill section 3). Every surface ends up here through POST /api/approvals/:id.
import type { ApprovalDecision, ApprovalKind, ApprovalRequest, Position } from "@/types";
import {
  addEvent,
  createPendingApproval,
  decideApproval,
  getApproval,
  transition,
} from "@/db";

export class ApprovalError extends Error {
  constructor(public code: "not_found" | "already_resolved", message: string) {
    super(message);
  }
}

function describe(position: Position, kind: ApprovalKind): string {
  const price =
    position.renewal_price_cents == null
      ? "an unknown price"
      : `$${(position.renewal_price_cents / 100).toFixed(2)}`;
  return kind === "cancel"
    ? `${position.service_name} renews for ${price}. Cancel?`
    : `${position.service_name} made a retention offer during the cancel. Cancel anyway?`;
}

// Creates a pending ApprovalRequest and returns its id. A cancel request moves an open position to stop_pending.
export async function requestApproval(
  position: Position,
  kind: ApprovalKind = "cancel",
  detail?: string,
  workflowRunId: string | null = null,
): Promise<string> {
  if (kind === "cancel") await transition(position.id, ["open"], "stop_pending");
  const request = await createPendingApproval(position.id, kind, detail ?? describe(position, kind), workflowRunId);
  await addEvent(
    position.id,
    "approval_requested",
    kind === "cancel" ? "Approval requested" : "Retention offer needs your answer",
    request.detail,
    { approval_id: request.id, kind },
  );
  return request.id;
}

// Records the decision once and moves the position. The caller (src/app) then hands the request to src/agent to resume.
export async function resolveApproval(id: string, decision: ApprovalDecision): Promise<ApprovalRequest> {
  const existing = await getApproval(id);
  if (!existing) throw new ApprovalError("not_found", "Approval request not found");
  const request = await decideApproval(id, decision === "approve" ? "approved" : "declined");
  if (!request) throw new ApprovalError("already_resolved", "This approval was already answered");

  if (decision === "approve") {
    if (request.kind === "cancel") await transition(request.position_id, ["open", "stop_pending", "failed"], "approved");
    await addEvent(request.position_id, "approval_resolved", "You approved the cancel", request.detail, {
      approval_id: id,
      decision,
    });
  } else {
    const reason =
      request.kind === "cancel" ? "You chose to keep it" : "You kept it after a retention offer";
    await transition(request.position_id, ["open", "stop_pending", "approved", "cancelling", "failed"], "kept", reason);
    await addEvent(request.position_id, "position_kept", reason, null, { approval_id: id, decision });
  }
  return request;
}
