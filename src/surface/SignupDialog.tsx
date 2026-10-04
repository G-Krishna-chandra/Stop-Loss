"use client";

import clsx from "clsx";
import { Check, Info, Mic, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ServiceLogo } from "./ServiceLogo";
import { buttonClass } from "./ui";
import { useStartVoice } from "./voice/VoiceAssistant";

function domainOf(input: string): string | null {
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Pulls the site out of a typed request like "sign me up for cursor.com". Without a site, the rest is treated as a
// product name, which the sign-up route resolves to the official website.
function targetOf(prompt: string): { query: string; domain: string | null } | null {
  const text = prompt.trim();
  const site = text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s,]*)?/i)?.[0]?.replace(/[.,;:!?)]+$/, "");
  if (site) return { query: site, domain: domainOf(site) };
  const name = text
    .replace(/^(please\s+)?(can you\s+)?(sign (me )?up|start|get me|try)(\s+(for|to|with))?\s+/i, "")
    .replace(/\b(free\s+)?trials?\b(\s+(of|for))?/gi, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  return name.length >= 2 ? { query: name, domain: null } : null;
}

// "Have StopLoss sign up for X?" The user says or types what to sign up for, reviews what the agent will do, then confirms.
export function SignupButton({ canRun, large = false }: { canRun: boolean; large?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={large ? clsx(buttonClass.primary, "px-8 py-4 text-[17px]") : buttonClass.secondary}
        onClick={() => setOpen(true)}
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        Sign up for a trial
      </button>
      {open ? <SignupDialog canRun={canRun} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SignupDialog({ canRun, onClose }: { canRun: boolean; onClose: () => void }) {
  const router = useRouter();
  const startVoice = useStartVoice();
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targetOf(url);
  const domain = target?.domain ?? null;
  const name = (domain ? domain.split(".")[0] : (target?.query ?? "")).replace(/^./, (c) => c.toUpperCase());

  async function start() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: target.query }),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4" onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="signup-title" className="relative w-full max-w-[510px] rounded-2xl bg-white p-8 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-5 top-5 rounded-md p-1.5 text-muted hover:bg-neutral-100">
          <X className="h-5 w-5" />
        </button>

        {!confirming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (target) setConfirming(true);
            }}
          >
            <h2 id="signup-title" className="text-[26px] font-bold tracking-tight text-ink">
              Sign up for a trial
            </h2>
            <p className="mt-2 text-muted">Tell StopLoss what to sign up for. You’ll review it before anything starts.</p>
            <button
              type="button"
              onClick={() => {
                startVoice();
                onClose();
              }}
              className="mt-6 flex w-full items-center gap-4 rounded-xl border border-line p-4 text-left hover:bg-neutral-50"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                <Mic className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-semibold text-ink">Talk to StopLoss</span>
                <span className="block text-[15px] text-muted">Say something like “sign me up for a Cursor trial.”</span>
              </span>
            </button>
            <div className="my-5 flex items-center gap-3 text-sm text-muted">
              <span className="h-px flex-1 bg-line" />
              or type it
              <span className="h-px flex-1 bg-line" />
            </div>
            <label htmlFor="signup-url" className="sr-only">
              What should StopLoss sign up for?
            </label>
            <textarea
              id="signup-url"
              autoFocus
              rows={2}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (target) setConfirming(true);
                }
              }}
              placeholder="Sign me up for a trial at gamma.app"
              className="w-full resize-none rounded-lg border border-line px-4 py-3 text-[16px] outline-none focus:border-ink focus:ring-2 focus:ring-neutral-200"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={onClose} className={buttonClass.secondary}>
                Cancel
              </button>
              <button type="submit" disabled={!target} className={buttonClass.primary}>
                Continue
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <ServiceLogo name={name} domain={domain ?? ""} />
              <div>
                <div className="text-lg font-semibold text-ink">{name}</div>
                <div className="text-muted">{domain ?? "StopLoss finds the official site"}</div>
              </div>
            </div>
            <h2 id="signup-title" className="mt-7 text-[28px] font-bold leading-tight tracking-tight text-ink">
              Have StopLoss sign up for {name}?
            </h2>
            <p className="mt-3 text-[17px] text-muted">
              StopLoss will create the account, start the trial, and track the renewal for you.
            </p>
            <ul className="mt-6 flex flex-col gap-4">
              {[
                "Use your StopLoss email",
                "Pause for you to enter a card if the trial asks for one",
                "Start the free trial in a live browser you can watch",
                "Ask before cancelling",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3 text-[17px] text-neutral-700">
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
