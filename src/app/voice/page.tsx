import { Mic } from "lucide-react";
import Link from "next/link";
import { has } from "@/config";
import { getPosition, listPendingApprovals } from "@/db";
import { money, perPeriod, relativeDays } from "@/surface/format";
import { SetupNeeded } from "@/surface/SetupNeeded";
import { VoicePrompt } from "@/surface/VoicePrompt";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const header = (
    <div className="mb-10 flex gap-5">
      <Mic className="mt-2 h-9 w-9 text-ink" strokeWidth={1.75} aria-hidden="true" />
      <div>
        <h1 className="text-[40px] font-bold tracking-tight text-ink">Voice command</h1>
        <p className="mt-1 text-lg text-muted">Answer StopLoss out loud, hands-free.</p>
      </div>
    </div>
  );
  if (!has("DATABASE_URL")) {
    return (
      <>
        {header}
        <SetupNeeded keys={["DATABASE_URL"]} what="Voice approvals" />
      </>
    );
  }
  const pending = await listPendingApprovals();
  const first = pending[0];
  const position = first ? await getPosition(first.position_id) : null;

  if (!first || !position) {
    return (
      <>
        {header}
        <div className="mx-auto max-w-[730px] rounded-2xl border border-line bg-white p-12 text-center">
          <p className="text-xl font-semibold text-ink">Nothing needs your answer right now.</p>
          <p className="mt-2 text-muted">When a stop comes due, StopLoss asks here.</p>
          <Link href="/positions" className="mt-6 inline-block font-medium text-ink underline decoration-neutral-300 underline-offset-4 hover:decoration-ink">
            See positions
          </Link>
        </div>
      </>
    );
  }

  const when = relativeDays(position.renewal_date);
  const amount =
    position.renewal_price_cents == null
      ? ""
      : ` for ${money(position.renewal_price_cents, position.currency)}/${perPeriod(position.billing_period)}`;
  const prompt =
    first.kind === "retention_offer"
      ? `${position.service_name} offered a discount to stay. Cancel it anyway?`
      : `${position.service_name} renews ${when || "soon"}${amount}. Cancel it?`;

  return (
    <>
      {header}
      <VoicePrompt approvalId={first.id} prompt={prompt} />
      {pending.length > 1 ? (
        <p className="mt-6 text-center text-[15px] text-muted">{pending.length - 1} more waiting after this one.</p>
      ) : null}
    </>
  );
}
