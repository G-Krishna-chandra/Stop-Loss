// The single approval endpoint. The dialog, the voice prompt, the CLI, and curl all call this.
import { after } from "next/server";
import { z } from "zod";
import { afterApproval, afterRetentionOffer, executeCancel } from "@/agent";
import { ApprovalError, resolveApproval } from "@/approval";

export const maxDuration = 300;

const Body = z.object({ decision: z.enum(["approve", "decline"]) });

export async function POST(req: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Send {"decision": "approve" | "decline"}' }, { status: 400 });

  try {
    const request = await resolveApproval(id, parsed.data.decision);
    const run = request.kind === "retention_offer" ? await afterRetentionOffer(request) : await afterApproval(request);
    if (run) after(() => executeCancel(run.id));
    return Response.json({ status: request.status, runId: run?.id ?? null });
  } catch (err) {
    if (err instanceof ApprovalError) {
      return Response.json({ error: err.message }, { status: err.code === "not_found" ? 404 : 409 });
    }
    throw err;
  }
}
