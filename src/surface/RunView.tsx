"use client";

import clsx from "clsx";
import { Lock, Maximize2, Minimize2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentRun } from "@/types";
import { CardApproval } from "./CardApproval";
import { time } from "./format";
import { StepList } from "./Timeline";

const LABEL: Record<AgentRun["status"], string> = {
  running: "In progress",
  paused: "Needs you",
  succeeded: "Done",
  failed: "Stopped",
};

// A retention offer is answered through an approval, not by taking over the browser.
function isOffer(run: AgentRun): boolean {
  return run.kind === "cancel" && /offer|discount|pause/i.test(run.error ?? "");
}

// Live view of one agent run: steps on the left, the Kernel browser on the right. Polls until the run finishes.
// When the run hands off to the user (paused), the browser opens full screen so they can sign in or enter a card.
export function RunView({ initial }: { initial: AgentRun }) {
  const [run, setRun] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const statusRef = useRef(initial.status);
  const live = run.status === "running" || run.status === "paused";

  useEffect(() => {
    if (!live) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/runs/${run.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as AgentRun;
      if (statusRef.current !== "paused" && next.status === "paused" && !isOffer(next)) setExpanded(true);
      if (next.status !== "paused") setContinuing(false);
      statusRef.current = next.status;
      setRun(next);
    }, 1500);
    return () => clearInterval(t);
  }, [run.id, live]);

  async function resume() {
    setContinuing(true);
    const res = await fetch(`/api/runs/${run.id}/continue`, { method: "POST" });
    if (!res.ok) setContinuing(false);
  }

  const title = run.kind === "cancel" ? `Cancelling ${run.service_name}` : `Signing up for ${run.service_name}`;
  const subtitle =
    run.kind === "cancel"
      ? `StopLoss is cancelling your ${run.service_name} subscription. This may take a few minutes.`
      : `Our agent is checking for a free trial, then creating your account with your StopLoss email.`;
  const yourTurn = run.status === "paused" && !isOffer(run);

  return (
    <div>
      <div className="mb-7">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-[34px] font-bold tracking-tight text-ink md:text-[40px]">{title}</h1>
          <span
            className={clsx(
              "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[16px] font-medium",
              run.status === "succeeded" && "bg-emerald-50 text-emerald-700",
              run.status === "failed" && "bg-red-50 text-red-700",
              run.status === "paused" && "bg-amber-50 text-amber-800",
              run.status === "running" && "bg-sky-50 text-sky-800",
            )}
          >
            <span className="h-3.5 w-3.5 rounded-full border-2 border-current" aria-hidden="true" />
            {LABEL[run.status]}
          </span>
        </div>
        <p className="mt-1.5 text-lg text-muted">{run.error && run.status !== "running" ? run.error : subtitle}</p>
      </div>

      <CardApproval run={run} />

      {run.status === "paused" ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div className="max-w-3xl">
            <div className="font-semibold text-ink">StopLoss needs you</div>
            <p className="mt-1 text-[15px] text-neutral-700">
              {isOffer(run)
                ? "Answer the offer from Positions or Voice. StopLoss did not accept or decline it."
                : "Take over the browser to sign in or enter a card, then press Continue. StopLoss picks up where it stopped."}
            </p>
          </div>
          {isOffer(run) ? (
            <a href="/voice" className="inline-flex items-center rounded-lg bg-brand px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-brand-dark">
              Answer the offer
            </a>
          ) : (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-5 py-2.5 text-[15px] font-semibold text-ink hover:bg-neutral-50"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
                Take over browser
              </button>
              <ContinueButton busy={continuing} onClick={resume} />
            </div>
          )}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-line bg-white shadow-soft p-4">
          <StepList steps={run.steps} times={(iso) => time(iso)} />
        </section>

        <section className="rounded-2xl border border-line bg-white shadow-soft p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-ink">Live browser</h2>
              <p className="mt-0.5 text-[15px] text-muted">
                {yourTurn
                  ? "Your turn: you can click and type in this browser."
                  : live
                    ? `Our agent is interacting with ${run.service_name} in real time.`
                    : "The session has ended."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium",
                  yourTurn
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : live
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-line bg-neutral-50 text-muted",
                )}
              >
                <span
                  className={clsx("h-2.5 w-2.5 rounded-full", yourTurn ? "bg-amber-500" : live ? "bg-emerald-500" : "bg-neutral-400")}
                  aria-hidden="true"
                />
                {yourTurn ? "Your turn" : live ? "Agent active" : "Session ended"}
              </span>
              {run.live_view_url || run.replay_url ? (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  aria-label="Open the browser full screen"
                  className="rounded-lg border border-line p-2 text-neutral-700 hover:bg-neutral-50"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-brand-soft">
            <div className="flex items-center gap-3 border-b border-line bg-neutral-50 px-4 py-3">
              <span className="flex gap-2" aria-hidden="true">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-neutral-700">
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                <span className="truncate">{run.target_url ?? "about:blank"}</span>
              </div>
              <RotateCw className="h-4 w-4 text-neutral-400" aria-hidden="true" />
            </div>
            {expanded ? (
              <div className="flex aspect-[16/10] w-full items-center justify-center text-[15px] text-muted">
                Open in full screen.
              </div>
            ) : (
              <BrowserFrame run={run} live={live} className="block aspect-[16/10] w-full" />
            )}
          </div>
        </section>
      </div>

      {expanded ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Live browser for ${run.service_name}`}
          className="fixed inset-0 z-50 flex flex-col bg-black"
          onKeyDown={(e) => e.key === "Escape" && setExpanded(false)}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <span className="font-semibold">{title}</span>
              <span className="truncate text-sm text-neutral-300">
                {yourTurn
                  ? "Your turn: sign in or enter a card here, then press Continue."
                  : live
                    ? "The agent is driving. View only."
                    : "Replay of the session."}
              </span>
            </div>
            <div className="flex gap-2">
              {yourTurn ? <ContinueButton busy={continuing} onClick={resume} /> : null}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
                Exit full screen
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 px-3 pb-3">
            <BrowserFrame run={run} live={live} className="block h-full w-full rounded-lg bg-white" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ContinueButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center rounded-lg bg-brand px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
    >
      {busy ? "Continuing…" : "Continue"}
    </button>
  );
}

function BrowserFrame({ run, live, className }: { run: AgentRun; live: boolean; className: string }) {
  if (live && run.live_view_url) {
    // View-only while the agent drives. Interactive while paused, so the user can sign in or enter a card.
    const src =
      run.status === "paused"
        ? run.live_view_url
        : run.live_view_url + (run.live_view_url.includes("?") ? "&" : "?") + "readOnly=true";
    return (
      <iframe
        key={src}
        title={`Live browser for ${run.service_name}`}
        src={src}
        className={clsx(className, "bg-white")}
        allow="clipboard-read; clipboard-write"
      />
    );
  }
  if (!live && run.replay_url) {
    return <iframe title={`Replay for ${run.service_name}`} src={run.replay_url} className={clsx(className, "bg-white")} />;
  }
  return (
    <div className={clsx(className, "flex items-center justify-center text-[15px] text-muted")}>
      {live ? "Starting a browser…" : "No recording for this session."}
    </div>
  );
}
