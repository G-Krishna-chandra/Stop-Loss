import { getRun, pauseStaleRuns } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  await pauseStaleRuns();
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json(run);
}
