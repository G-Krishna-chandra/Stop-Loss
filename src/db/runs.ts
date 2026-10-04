import type { AgentRun, RunKind, RunStatus, RunStep } from "@/types";
import { iso, sql } from "./client";

type Row = Record<string, unknown>;

function toRun(r: Row): AgentRun {
  return {
    id: String(r.id),
    position_id: (r.position_id as string | null) ?? null,
    kind: r.kind as RunKind,
    status: r.status as RunStatus,
    service_name: String(r.service_name),
    target_url: (r.target_url as string | null) ?? null,
    live_view_url: (r.live_view_url as string | null) ?? null,
    replay_url: (r.replay_url as string | null) ?? null,
    browser_session_id: (r.browser_session_id as string | null) ?? null,
    steps: (r.steps as RunStep[]) ?? [],
    error: (r.error as string | null) ?? null,
    started_at: iso(r.started_at) ?? "",
    invoked_at: iso(r.invoked_at) ?? iso(r.started_at) ?? "",
    finished_at: iso(r.finished_at),
  };
}

export async function createRun(input: {
  kind: RunKind;
  service_name: string;
  position_id: string | null;
  target_url: string | null;
  steps: RunStep[];
}): Promise<AgentRun> {
  const rows = await sql()`
    insert into agent_runs (kind, service_name, position_id, target_url, steps)
    values (${input.kind}, ${input.service_name}, ${input.position_id}, ${input.target_url}, ${JSON.stringify(input.steps)}::jsonb)
    returning *`;
  return toRun(rows[0]);
}

export async function getRun(id: string): Promise<AgentRun | null> {
  const rows = await sql()`select * from agent_runs where id = ${id}`;
  return rows[0] ? toRun(rows[0]) : null;
}

export async function latestRunFor(positionId: string, kind?: RunKind): Promise<AgentRun | null> {
  const rows = kind
    ? await sql()`select * from agent_runs where position_id = ${positionId} and kind = ${kind} order by started_at desc limit 1`
    : await sql()`select * from agent_runs where position_id = ${positionId} order by started_at desc limit 1`;
  return rows[0] ? toRun(rows[0]) : null;
}

// Vercel stops a function after maxDuration (300 s), which can cut an agent run off mid-task. A run still marked
// running 320 s after its attempt began is paused when its Kernel browser exists (Continue resumes it there),
// and failed when it never got a browser.
export async function pauseStaleRuns(): Promise<void> {
  await sql()`
    update agent_runs set
      status = case when browser_session_id is null then 'failed' else 'paused' end,
      error = case when browser_session_id is null
        then 'This run hit the 5-minute limit before the browser started.'
        else 'This run hit the 5-minute limit. The browser is still open where it stopped.' end,
      finished_at = case when browser_session_id is null then now() else null end
    where status = 'running' and invoked_at < now() - interval '320 seconds'`;
}

export async function listRuns(limit = 100): Promise<AgentRun[]> {
  const rows = await sql()`select * from agent_runs order by started_at desc limit ${limit}`;
  return rows.map(toRun);
}

export async function listActiveRuns(): Promise<AgentRun[]> {
  const rows = await sql()`select * from agent_runs where status in ('running', 'paused') order by started_at desc`;
  return rows.map(toRun);
}

export async function updateRun(
  id: string,
  patch: Partial<Pick<AgentRun, "status" | "live_view_url" | "replay_url" | "browser_session_id" | "steps" | "error" | "position_id" | "invoked_at">>,
): Promise<AgentRun> {
  const current = await getRun(id);
  if (!current) throw new Error(`Run ${id} not found`);
  const next = { ...current, ...patch };
  const finished = next.status === "succeeded" || next.status === "failed";
  const rows = await sql()`
    update agent_runs set
      status = ${next.status},
      live_view_url = ${next.live_view_url},
      replay_url = ${next.replay_url},
      browser_session_id = ${next.browser_session_id},
      steps = ${JSON.stringify(next.steps)}::jsonb,
      error = ${next.error},
      position_id = ${next.position_id},
      invoked_at = ${next.invoked_at},
      finished_at = case when ${finished} then coalesce(finished_at, now()) else null end
    where id = ${id}
    returning *`;
  return toRun(rows[0]);
}

// Marks one step and returns the run. Steps before it become done, steps after it stay pending.
export async function advanceRun(id: string, key: string, detail?: string, status: RunStep["status"] = "active"): Promise<AgentRun> {
  const run = await getRun(id);
  if (!run) throw new Error(`Run ${id} not found`);
  const index = run.steps.findIndex((s) => s.key === key);
  const now = new Date().toISOString();
  const steps = run.steps.map((s, i) => {
    if (i < index && s.status !== "failed") return { ...s, status: "done" as const, at: s.at ?? now };
    if (i === index) return { ...s, status, detail: detail ?? s.detail, at: now };
    return s;
  });
  return updateRun(id, { steps });
}
