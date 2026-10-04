"use client";

import { ExternalLink, Link2, MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// The "..." menu on a run row in Activity: open it, jump to its position, copy its link, or delete it.
export function RunMenu({ runId, positionId, live }: { runId: string; positionId: string | null; live: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setConfirming(false);
    setError(null);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Couldn’t delete this run.");
      return;
    }
    close();
    router.refresh();
  }

  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] text-ink hover:bg-neutral-100";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Run options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-ink"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-[230px] rounded-xl border border-line bg-white p-1.5 shadow-float">
          {confirming ? (
            <div className="p-2">
              <p className="text-[14px] font-semibold text-ink">Delete this run?</p>
              <p className="mt-1 text-[13px] text-muted">
                {live ? "Its browser closes and the run stops. " : ""}The position and its history stay.
              </p>
              {error ? <p className="mt-2 text-[13px] font-medium text-red-600">{error}</p> : null}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold hover:bg-neutral-50">
                  Keep
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <Link role="menuitem" href={`/runs/${runId}`} className={item}>
                <ExternalLink className="h-4 w-4 text-neutral-500" aria-hidden="true" />
                Open run
              </Link>
              {positionId ? (
                <Link role="menuitem" href={`/positions/${positionId}`} className={item}>
                  <ExternalLink className="h-4 w-4 text-neutral-500" aria-hidden="true" />
                  Open position
                </Link>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}/runs/${runId}`);
                  close();
                }}
              >
                <Link2 className="h-4 w-4 text-neutral-500" aria-hidden="true" />
                Copy link
              </button>
              <div className="my-1 h-px bg-line" />
              <button type="button" role="menuitem" className={item + " text-red-600 hover:bg-red-50"} onClick={() => setConfirming(true)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {live ? "Stop and delete" : "Delete run"}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
