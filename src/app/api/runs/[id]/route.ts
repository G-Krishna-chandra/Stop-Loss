import { endBrowser } from "@/cancel";
import { deleteRun, getRun, pauseStaleRuns } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  await pauseStaleRuns();
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json(run);
}

// Deletes a run from Activity. A run that's still live has its browser shut first, so nothing keeps running unseen.
// The position it belongs to, and that position's history, stay.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  if ((run.status === "running" || run.status === "paused") && run.browser_session_id) await endBrowser(run.browser_session_id);
  await deleteRun(id);
  return Response.json({ deleted: id });
}
