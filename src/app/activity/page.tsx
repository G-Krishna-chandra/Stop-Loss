import clsx from "clsx";
import Link from "next/link";
import { has } from "@/config";
import { listLedger, listRuns, pauseStaleRuns } from "@/db";
import { dayTime } from "@/surface/format";
import { RunMenu } from "@/surface/RunMenu";
import { ServiceLogo } from "@/surface/ServiceLogo";
import { SetupNeeded } from "@/surface/SetupNeeded";
import { Card, PageHeader } from "@/surface/ui";
import type { AgentRun } from "@/types";

export const dynamic = "force-dynamic";

const STATUS: Record<AgentRun["status"], { label: string; cls: string }> = {
  running: { label: "In progress", cls: "bg-sky-50 text-sky-800" },
  paused: { label: "Needs you", cls: "bg-amber-50 text-amber-800" },
  succeeded: { label: "Done", cls: "bg-emerald-50 text-emerald-700" },
  failed: { label: "Stopped", cls: "bg-red-50 text-red-700" },
};

function domainOf(run: AgentRun): string {
  try {
    return run.target_url ? new URL(run.target_url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

function duration(run: AgentRun): string {
  if (!run.finished_at) return run.status === "paused" ? "waiting on you" : "running";
  const s = Math.max(0, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// The outcome in one line: the error or reason when there is one, else the last step that ran.
function summary(run: AgentRun): string {
  if (run.error) return run.error;
  const touched = run.steps.filter((s) => s.status !== "pending");
  const last = touched[touched.length - 1];
  return last ? `${last.title}: ${last.detail}` : "Starting";
}

export default async function ActivityPage() {
  const header = <PageHeader eyebrow="Agent runs" title="Activity" subtitle="Every browser run StopLoss did, and everything it logged." />;
  if (!has("DATABASE_URL")) {
    return (
      <>
        {header}
        <SetupNeeded keys={["DATABASE_URL"]} what="The activity ledger" />
      </>
    );
  }
  await pauseStaleRuns();
  const [runs, ledger] = await Promise.all([listRuns(), listLedger(100)]);
  // Log entries only link to runs that still exist.
  const runIds = new Set(runs.map((r) => r.id));
  return (
    <>
      {header}

      <h2 className="mb-3 text-xl font-semibold text-ink">Browser runs</h2>
      <Card className="mb-10">
        {runs.length === 0 ? (
          <p className="px-6 py-12 text-center text-muted">No runs yet. Sign up for a trial or cancel one to start a live browser run.</p>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((r) => {
              const st = STATUS[r.status];
              return (
                <li key={r.id} className="flex items-center gap-2 pr-4 first:rounded-t-2xl last:rounded-b-2xl hover:bg-neutral-50">
                  <Link href={`/runs/${r.id}`} className="flex min-w-0 flex-1 items-center gap-4 py-4 pl-6">
                    <ServiceLogo name={r.service_name} domain={domainOf(r)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">
                          {r.kind === "cancel" ? "Cancel" : "Sign-up"} · {r.service_name}
                        </span>
                        <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[15px] text-muted">{summary(r)}</div>
                    </div>
                    <div className="hidden shrink-0 text-right text-sm text-muted sm:block">
                      <div>{dayTime(r.started_at)}</div>
                      <div>{duration(r)}</div>
                    </div>
                  </Link>
                  <RunMenu runId={r.id} positionId={r.position_id} live={r.status === "running" || r.status === "paused"} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <h2 className="mb-3 text-xl font-semibold text-ink">Log</h2>
      <Card className="overflow-hidden">
        {ledger.length === 0 ? (
          <p className="px-6 py-12 text-center text-muted">Nothing has happened yet.</p>
        ) : (
          <ol className="divide-y divide-line">
            {ledger.map((e) => {
              const runId = typeof e.payload.run_id === "string" && runIds.has(e.payload.run_id) ? e.payload.run_id : null;
              const row = (
                <>
                  {e.service_name && e.service_domain ? (
                    <ServiceLogo name={e.service_name} domain={e.service_domain} size="sm" />
                  ) : (
                    <span className="h-10 w-10 shrink-0 rounded-xl bg-brand-soft" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">
                      {e.title}
                      {e.service_name ? <span className="ml-2 font-normal text-muted">{e.service_name}</span> : null}
                    </div>
                    {e.detail ? <div className="mt-0.5 text-[15px] text-muted">{e.detail}</div> : null}
                  </div>
                  <time className="shrink-0 text-sm text-muted" dateTime={e.created_at}>
                    {dayTime(e.created_at)}
                  </time>
                </>
              );
              return (
                <li key={e.id}>
                  {runId ? (
                    <Link href={`/runs/${runId}`} className="flex items-start gap-4 px-6 py-4 hover:bg-neutral-50">
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-4 px-6 py-4">{row}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
