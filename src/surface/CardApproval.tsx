import { CreditCard, ExternalLink } from "lucide-react";
import type { AgentRun } from "@/types";

// Shown on a sign-up run while its single-use Link card waits for the user's approval.
export function CardApproval({ run }: { run: AgentRun }) {
  if (!run.card_note) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-white p-5 shadow-soft">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink text-white">
          <CreditCard className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <div className="font-semibold text-ink">{run.card_note}</div>
          <p className="mt-1 text-[15px] text-muted">
            {run.card_action_url
              ? "Link opens in a new tab. Once you approve, StopLoss fills the card into the checkout. The number never reaches StopLoss."
              : "Approve it in your Link app. Once you do, StopLoss fills the card into the checkout. The number never reaches StopLoss."}
          </p>
        </div>
      </div>
      {run.card_action_url ? (
        <a
          href={run.card_action_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-black"
        >
          Approve in Link
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}
