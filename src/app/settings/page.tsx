import { CheckCircle2, CircleDashed, CreditCard } from "lucide-react";
import { getCardStatus } from "@/cards";
import { has, INTEGRATIONS } from "@/config";
import { stopLossAddress } from "@/inbox";
import { CopyButton } from "@/surface/CopyButton";
import { buttonClass, Card, CardTitle, Note, PageHeader } from "@/surface/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [address, card] = await Promise.all([
    has("AGENTMAIL_API_KEY") ? stopLossAddress().catch(() => null) : Promise.resolve(null),
    getCardStatus().catch(() => null),
  ]);
  return (
    <>
      <PageHeader eyebrow="Setup" title="Settings" subtitle="Your StopLoss address, virtual cards, stop timing, and the services StopLoss uses." />
      <div className="grid max-w-[1000px] gap-6">
        <Card className="p-6">
          <CardTitle>StopLoss address</CardTitle>
          {address ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 truncate rounded-xl bg-brand-soft px-4 py-3 font-mono text-[16px] text-ink">{address}</span>
              <CopyButton value={address} compact />
            </div>
          ) : (
            <p className="text-[16px] text-neutral-700">Created when AGENTMAIL_API_KEY is set.</p>
          )}
        </Card>

        <section id="cards" className="scroll-mt-24">
          <Card className="p-6">
            <CardTitle icon={CreditCard}>Single-use virtual cards</CardTitle>
            <p className="text-[16px] leading-relaxed text-neutral-700">
              Each trial StopLoss signs up for gets a new single-use card from your Link wallet. You approve each card. The card number
              goes straight into the checkout; StopLoss never sees it.
            </p>
            <p className="mt-2 text-[14px] text-muted">Needs a Link account with a US phone number.</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {card?.state === "connected" ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3.5 py-1.5 text-[15px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Single-use cards are on
                </span>
              ) : card?.state === "connecting" ? (
                // Always through the connect route: Link sign-in links expire after 10 minutes, so each click gets a fresh one.
                <a href="/api/cards/connect" className={buttonClass.primary}>
                  Finish connecting
                </a>
              ) : card?.state === "not_connected" || card?.state === "error" ? (
                <a href="/api/cards/connect" className={buttonClass.primary}>
                  Connect Link wallet
                </a>
              ) : null}
            </div>
            {card?.state === "not_configured" ? (
              <div className="mt-4">
                <Note>Add KERNEL_API_KEY to turn on virtual cards.</Note>
              </div>
            ) : card?.detail && card.state !== "connected" ? (
              <p className="mt-3 text-[14px] text-muted">{card.detail}</p>
            ) : null}
          </Card>
        </section>

        <Card className="p-6">
          <CardTitle>Stops</CardTitle>
          <p className="text-[16px] text-neutral-700">
            StopLoss asks you {process.env.STOP_LEAD_HOURS ?? "24"} hours before each renewal. Change it with{" "}
            <code className="rounded bg-brand-soft px-1.5 py-0.5 text-sm">STOP_LEAD_HOURS</code>.
          </p>
        </Card>

        <Card className="p-6">
          <CardTitle>Integrations</CardTitle>
          <p className="-mt-2 mb-4 text-[15px] text-muted">
            Keys live in <code className="rounded bg-brand-soft px-1.5 py-0.5 text-sm">.env.local</code>. This page only shows whether
            each one is set.
          </p>
          <ul className="divide-y divide-line">
            {INTEGRATIONS.map((i) => {
              const ok = has(i.key);
              return (
                <li key={i.key} className="flex items-start gap-4 py-4">
                  {ok ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Connected" />
                  ) : (
                    <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" aria-label="Not connected" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">
                      {i.name} <span className="ml-2 font-mono text-xs font-normal text-muted">{i.key}</span>
                    </div>
                    <div className="text-[15px] text-muted">{i.role}</div>
                    {!ok ? <div className="mt-1 text-sm text-muted">Get it at {i.where}.</div> : null}
                  </div>
                  <span className={ok ? "text-sm font-medium text-emerald-700" : "text-sm font-medium text-muted"}>
                    {ok ? "Connected" : "Not connected"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
