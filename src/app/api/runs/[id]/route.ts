import { getRun, updateRun } from "@/db";

export const dynamic = "force-dynamic";

// Vercel stops a function after maxDuration (300 s), which can cut an agent run off mid-task. A run still marked
// running well past that is paused: its Kernel browser stays open (15 min timeout), so Continue picks it back up.
const LIMIT_MS = 320_000;

export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  let run = await getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  if (run.status === "running" && Date.now() - new Date(run.invoked_at).getTime() > LIMIT_MS) {
    run = await updateRun(id, run.browser_session_id
      ? { status: "paused", error: "This run hit the 5-minute limit. The browser is still open where it stopped." }
      : { status: "failed", error: "This run hit the 5-minute limit before the browser started." });
  }
  return Response.json(run);
}
