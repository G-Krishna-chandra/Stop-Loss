import clsx from "clsx";
import { Check, X } from "lucide-react";
import type { RunStep } from "@/types";

// Vertical step list used by agent runs and the activity trace.
export function StepList({ steps, times }: { steps: RunStep[]; times: (iso: string | null) => string }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex gap-4 pb-2">
          {i < steps.length - 1 ? (
            <span
              className={clsx("absolute left-[15px] top-9 h-[calc(100%-1.5rem)] w-0.5", s.status === "done" ? "bg-emerald-400" : "bg-slate-200")}
              aria-hidden="true"
            />
          ) : null}
          <div
            className={clsx(
              "flex w-full gap-4 rounded-xl px-3 py-3",
              s.status === "active" && "bg-blue-50",
            )}
          >
            <StepIcon status={s.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <span className={clsx("text-[17px] font-semibold", s.status === "pending" ? "text-slate-700" : "text-slate-900")}>
                  {s.title}
                </span>
                {s.at ? <span className="shrink-0 text-sm text-slate-500">{times(s.at)}</span> : null}
              </div>
              <p className={clsx("mt-0.5 text-[15px]", s.status === "failed" ? "text-red-600" : "text-slate-500")}>{s.detail}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ status }: { status: RunStep["status"] }) {
  if (status === "done")
    return (
      <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check className="h-5 w-5" strokeWidth={3} aria-label="Done" />
      </span>
    );
  if (status === "failed")
    return (
      <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
        <X className="h-5 w-5" strokeWidth={3} aria-label="Failed" />
      </span>
    );
  if (status === "active")
    return (
      <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white" aria-label="In progress">
        <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-blue-200 border-t-brand" />
      </span>
    );
  return <span className="relative z-10 h-8 w-8 shrink-0 rounded-full border-2 border-slate-300 bg-white" aria-label="Pending" />;
}

export type TraceItem = { id: string; title: string; detail: string | null; at: string };

export function Trace({ items, times }: { items: TraceItem[]; times: (iso: string) => string }) {
  if (items.length === 0) return <p className="text-slate-500">Nothing yet.</p>;
  return (
    <ol className="flex flex-col">
      {items.map((e, i) => (
        <li key={e.id} className="relative flex gap-5 pb-5 last:pb-0">
          {i < items.length - 1 ? <span className="absolute left-[5px] top-4 h-full w-0.5 bg-blue-200" aria-hidden="true" /> : null}
          <span className="relative z-10 mt-1.5 h-3 w-3 shrink-0 rounded-full bg-brand" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 justify-between gap-4">
            <div className="min-w-0">
              <div className="font-semibold text-slate-900">{e.title}</div>
              {e.detail ? <div className="mt-0.5 text-[15px] text-slate-500">{e.detail}</div> : null}
            </div>
            <div className="shrink-0 text-right text-sm text-slate-500">{times(e.at)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
