// "Cancel subscription" on a position that has no pending request: the dialog's confirm is the explicit approval.
import { after } from "next/server";
import { z } from "zod";
import { afterApproval, executeCancel } from "@/agent";
import { requestApproval, resolveApproval } from "@/approval";
import { getPosition } from "@/db";

export const maxDuration = 300;

const Body = z.object({ decision: z.literal("approve") });

export async function POST(req: Request, ctx: RouteContext<"/api/positions/[id]/cancel">) {
  const { id } = await ctx.params;
  if (!Body.safeParse(await req.json().catch(() => null)).success) {
    return Response.json({ error: 'Send {"decision": "approve"}' }, { status: 400 });
  }
  const position = await getPosition(id);
  if (!position) return Response.json({ error: "Position not found" }, { status: 404 });
  if (!["open", "stop_pending", "failed"].includes(position.status)) {
    return Response.json({ error: `This position is ${position.status.replace("_", " ")}.` }, { status: 409 });
  }
  const approvalId = await requestApproval(position, "cancel", `You asked StopLoss to cancel ${position.service_name}.`);
  const request = await resolveApproval(approvalId, "approve");
  const run = await afterApproval(request);
  if (run) after(() => executeCancel(run.id));
  return Response.json({ status: request.status, runId: run?.id ?? null });
}
