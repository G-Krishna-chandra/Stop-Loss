"use client";

import { Check, Info, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ServiceLogo } from "./ServiceLogo";
import { buttonClass } from "./ui";

function domainOf(input: string): string | null {
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// "Have StopLoss sign up for X?" The user names a product, reviews what the agent will do, then confirms.
export function SignupButton({ canRun }: { canRun: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClass.secondary} onClick={() => setOpen(true)}>
        <Plus className="h-5 w-5" aria-hidden="true" />
        Sign up for a trial
      </button>
      {open ? <SignupDialog canRun={canRun} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SignupDialog({ canRun, onClose }: { canRun: boolean; onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = domainOf(url.trim());
  const name = domain ? domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : "";

  async function start() {
    if (!domain) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    });
    const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
    if (!res.ok || !data.runId) {
      setError(data.error ?? "StopLoss could not start the sign-up.");
      setBusy(false);
      return;
    }
    router.push(`/runs/${data.runId}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="signup-title" className="relative w-full max-w-[510px] rounded-2xl bg-white p-8 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-5 top-5 rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
          <X className="h-5 w-5" />
        </button>

        {!confirming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (domain) setConfirming(true);
            }}
          >
            <h2 id="signup-title" className="text-[26px] font-bold tracking-tight text-slate-900">
              Sign up for a trial
            </h2>
            <p className="mt-2 text-slate-500">Name the product’s website. You’ll review the details before StopLoss starts.</p>
            <label htmlFor="signup-url" className="mt-6 block text-sm font-medium text-slate-700">
              Website
            </label>
            <input
              id="signup-url"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="gamma.app"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-4 py-3 text-[16px] outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
            />
            <div className="mt-7 flex justify-end gap-3">
              <button type="button" onClick={onClose} className={buttonClass.secondary}>
                Cancel
              </button>
              <button type="submit" disabled={!domain} className={buttonClass.primary}>
                Continue
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <ServiceLogo name={name} domain={domain!} />
              <div>
                <div className="text-lg font-semibold text-slate-900">{name}</div>
                <div className="text-slate-500">{domain}</div>
              </div>
            </div>
            <h2 id="signup-title" className="mt-7 text-[28px] font-bold leading-tight tracking-tight text-slate-900">
              Have StopLoss sign up for {name}?
            </h2>
            <p className="mt-3 text-[17px] text-slate-600">
              StopLoss will create the account, start the trial, and track the renewal for you.
            </p>
            <ul className="mt-6 flex flex-col gap-4">
              {[
                "Use your StopLoss email",
                "Pause for you to enter a card if the trial asks for one",
                "Start the free trial in a live browser you can watch",
                "Ask before cancelling",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3 text-[17px] text-slate-700">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white">
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-[15px] text-amber-900">
              <Info className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              No charge happens without your approval.
            </div>
            {!canRun ? (
              <p className="mt-4 text-sm font-medium text-red-600">Add KERNEL_API_KEY to .env.local to run sign-ups.</p>
            ) : null}
            {error ? <p className="mt-4 text-sm font-medium text-red-600">{error}</p> : null}
            <div className="mt-7 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={buttonClass.secondary}>
                Back
              </button>
              <button type="button" onClick={start} disabled={busy || !canRun} className={buttonClass.primary}>
                {busy ? "Starting…" : "Yes, sign me up"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
