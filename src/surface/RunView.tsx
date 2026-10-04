"use client";

import clsx from "clsx";
import { Lock, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentRun } from "@/types";
import { time } from "./format";
import { StepList } from "./Timeline";

const LABEL: Record<AgentRun["status"], string> = {
  running: "In progress",
  paused: "Needs you",
  succeeded: "Done",
  failed: "Stopped",
};

// Live view of one agent run: steps on the left, the Kernel browser on the right. Polls until the run finishes.
export function RunView({ initial }: { initial: AgentRun }) {
  const [run, setRun] = useState(initial);
  const live = run.status === "running" || run.status === "paused";

  useEffect(() => {
    if (!live) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/runs/${run.id}`, { cache: "no-store" });
      if (res.ok) setRun((await res.json()) as AgentRun);
    }, 1500);
    return () => clearInterval(t);
  }, [run.id, live]);

  const title = run.kind === "cancel" ? `Cancelling ${run.service_name}` : `Signing up for ${run.service_name}`;
  const subtitle =
    run.kind === "cancel"
      ? `StopLoss is cancelling your ${run.service_name} subscription. This may take a few minutes.`
      : `Our agent is creating your account and starting the trial with your StopLoss email.`;

  return (
    <div>
      <div className="mb-7">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-[34px] font-bold tracking-tight text-slate-900 md:text-[40px]">{title}</h1>
          <span
            className={clsx(
              "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[16px] font-medium",
              run.status === "succeeded" && "bg-emerald-50 text-emerald-700",
              run.status === "failed" && "bg-red-50 text-red-700",
              run.status === "paused" && "bg-amber-50 text-amber-800",
              run.status === "running" && "bg-blue-50 text-blue-700",
            )}
          >
            <span className="h-3.5 w-3.5 rounded-full border-2 border-current" aria-hidden="true" />
            {LABEL[run.status]}
          </span>
        </div>
        <p className="mt-1.5 text-lg text-slate-500">{run.error && run.status === "failed" ? run.error : subtitle}</p>
      </div>

      {run.status === "paused" ? <PausedBanner run={run} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <StepList steps={run.steps} times={(iso) => time(iso)} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Live browser</h2>
              <p className="mt-0.5 text-[15px] text-slate-500">
                {live ? `Our agent is interacting with ${run.service_name} in real time.` : "The session has ended."}
              </p>
            </div>
            <span
              className={clsx(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium",
                live ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600",
              )}
            >
              <span className={clsx("h-2.5 w-2.5 rounded-full", live ? "bg-emerald-500" : "bg-slate-400")} aria-hidden="true" />
              {live ? "Agent active" : "Session ended"}
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <span className="flex gap-2" aria-hidden="true">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
                <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span className="truncate">{run.target_url ?? "about:blank"}</span>
              </div>
              <RotateCw className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </div>
            <BrowserFrame run={run} live={live} />
          </div>
        </section>
      </div>
    </div>
  );
}

// A paused run is waiting on the user: sign in or enter a card in the live browser, or answer a retention offer.
function PausedBanner({ run }: { run: AgentRun }) {
  const [busy, setBusy] = useState(false);
  const offer = run.kind === "cancel" && /offer|discount|pause/i.test(run.error ?? "");
  async function resume() {
    setBusy(true);
    await fetch(`/api/runs/${run.id}/continue`, { method: "POST" });
  }
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 p-5">
      <div className="max-w-3xl">
        <div className="font-semibold text-slate-900">StopLoss needs you</div>
        <p className="mt-1 text-[15px] text-slate-700">
          {run.error}{" "}
          {offer
            ? "Answer the offer from Positions or Voice. StopLoss did not accept or decline it."
            : "Use the live browser below (you can type in it now), then press Continue."}
        </p>
      </div>
      {offer ? (
        <a href="/voice" className="inline-flex items-center rounded-lg bg-brand px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-brand-dark">
          Answer the offer
        </a>
      ) : (
        <button
          type="button"
          onClick={resume}
          disabled={busy}
          className="inline-flex items-center rounded-lg bg-brand px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? "Continuing…" : "Continue"}
        </button>
      )}
    </div>
  );
}

function BrowserFrame({ run, live }: { run: AgentRun; live: boolean }) {
  if (live && run.live_view_url) {
    // View-only while the agent drives. Interactive while paused, so the user can sign in or enter a card.
    const src =
      run.status === "paused"
        ? run.live_view_url
        : run.live_view_url + (run.live_view_url.includes("?") ? "&" : "?") + "readOnly=true";
    return (
      <iframe
        title={`Live browser for ${run.service_name}`}
        src={src}
        className="block aspect-[16/10] w-full bg-white"
        allow="clipboard-read; clipboard-write"
      />
    );
  }
  if (!live && run.replay_url) {
    return <iframe title={`Replay for ${run.service_name}`} src={run.replay_url} className="block aspect-[16/10] w-full bg-white" />;
  }
  return (
    <div className="flex aspect-[16/10] w-full items-center justify-center text-[15px] text-slate-500">
      {live ? "Starting a browser…" : "No recording for this session."}
    </div>
  );
}
