"use client";

import { AlertCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "./ui";

export type CancelTarget = {
  positionId: string;
  approvalId: string | null;
  serviceName: string;
  plan: string | null;
  renewsLabel: string;
  renewsDate: string;
  priceLabel: string;
  kind: "cancel" | "retention_offer";
  offer: string | null;
};

// Opens the "Cancel X subscription?" dialog. Approving is the explicit human approval the safety rules require.
export function CancelButton({
  target,
  label,
  className,
  icon,
}: {
  target: CancelTarget;
  label: string;
  className: string;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {icon}
        {label}
      </button>
      {open ? <CancelDialog target={target} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CancelDialog({ target, onClose }: { target: CancelTarget; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  async function decide(decision: "approve" | "decline") {
    if (decision === "decline" && !target.approvalId) return onClose();
    setBusy(decision);
    setError(null);
    const url = target.approvalId ? `/api/approvals/${target.approvalId}` : `/api/positions/${target.positionId}/cancel`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
    if (!res.ok) {
      setError(data.error ?? "That did not go through. Try again.");
      setBusy(null);
      return;
    }
    if (data.runId) router.push(`/runs/${data.runId}`);
    else {
      onClose();
      router.refresh();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4"
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-title"
        className="relative w-full max-w-[580px] rounded-2xl bg-white p-8 shadow-2xl md:p-10"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy !== null}
          aria-label="Close"
          className="absolute right-5 top-5 rounded-md p-1.5 text-muted hover:bg-neutral-100"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 id="cancel-title" className="pr-8 text-[28px] font-bold tracking-tight text-ink">
          {target.kind === "retention_offer"
            ? `${target.serviceName} offered you a discount to stay`
            : `Cancel ${target.serviceName} subscription?`}
        </h2>
        {target.offer ? (
          <p className="mt-4 rounded-xl border border-line bg-neutral-50 p-4 text-[16px] text-neutral-800">{target.offer}</p>
        ) : null}
        <dl className="mt-6 divide-y divide-line rounded-xl border border-line">
          {[
            ["Plan", target.plan ?? "Unknown"],
            [target.renewsLabel, target.renewsDate],
            ["Price", target.priceLabel],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-2 px-6 py-4">
              <dt className="text-[15px] font-medium text-muted">{k}</dt>
              <dd className="text-[17px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="text-[15px] font-medium text-ink">
              {target.kind === "retention_offer"
                ? "StopLoss paused and did not accept or decline the offer. Cancel anyway, or keep the subscription."
                : `StopLoss opens your ${target.serviceName} account in a live browser and cancels the plan before it renews.`}
            </p>
            <p className="mt-1 text-sm text-muted">No cancellation happens without your explicit approval.</p>
          </div>
        </div>
        {error ? <p className="mt-4 text-sm font-medium text-red-600">{error}</p> : null}
        <div className="mt-7 grid grid-cols-2 gap-4">
          <button
            ref={keepRef}
            type="button"
            onClick={() => decide("decline")}
            disabled={busy !== null}
            className={buttonClass.secondary + " py-3.5 text-base"}
          >
            {busy === "decline" ? "Saving…" : "Keep subscription"}
          </button>
          <button
            type="button"
            onClick={() => decide("approve")}
            disabled={busy !== null}
            className={buttonClass.primary + " py-3.5 text-base"}
          >
            {busy === "approve" ? "Starting…" : target.kind === "retention_offer" ? "Cancel anyway" : "Yes, cancel subscription"}
          </button>
        </div>
      </div>
    </div>
  );
}
