// The user finished a manual step in the live browser (signed in, or entered a card). Resume the same session.
import { after } from "next/server";
import { executeCancel, executeSignup } from "@/agent";
import { getRun } from "@/db";

export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/runs/[id]/continue">) {
  const { id } = await ctx.params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "paused" || !run.browser_session_id) {
    return Response.json({ error: "This run is not waiting for you." }, { status: 409 });
  }
  after(() => (run.kind === "cancel" ? executeCancel(id, { resume: true }) : executeSignup(id, { resume: true })));
  return Response.json({ ok: true });
}
