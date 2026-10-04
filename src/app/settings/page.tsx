import { CheckCircle2, CircleDashed } from "lucide-react";
import { has, INTEGRATIONS } from "@/config";
import { stopLossAddress } from "@/inbox";
import { Card, CardTitle, PageHeader } from "@/surface/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const address = has("AGENTMAIL_API_KEY") ? await stopLossAddress().catch(() => null) : null;
  return (
    <>
      <PageHeader title="Settings" subtitle="Your StopLoss address, stop timing, and the services StopLoss uses." />
      <div className="grid max-w-[1000px] gap-6">
        <Card className="p-6">
          <CardTitle>Integrations</CardTitle>
          <p className="-mt-2 mb-4 text-[15px] text-slate-500">
            Keys live in <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">.env.local</code>. This page only shows whether
            each one is set.
          </p>
          <ul className="divide-y divide-slate-100">
            {INTEGRATIONS.map((i) => {
              const ok = has(i.key);
              return (
                <li key={i.key} className="flex items-start gap-4 py-4">
                  {ok ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Connected" />
                  ) : (
                    <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-label="Not connected" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900">
                      {i.name} <span className="ml-2 font-mono text-xs font-normal text-slate-500">{i.key}</span>
                    </div>
                    <div className="text-[15px] text-slate-600">{i.role}</div>
                    {!ok ? <div className="mt-1 text-sm text-slate-500">Get it at {i.where}.</div> : null}
                  </div>
                  <span className={ok ? "text-sm font-medium text-emerald-700" : "text-sm font-medium text-slate-500"}>
                    {ok ? "Connected" : "Not connected"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="p-6">
          <CardTitle>StopLoss address</CardTitle>
          <p className="text-[16px] text-slate-700">{address ?? "Created when AGENTMAIL_API_KEY is set."}</p>
        </Card>
        <Card className="p-6">
          <CardTitle>Stops</CardTitle>
          <p className="text-[16px] text-slate-700">
            StopLoss asks you {process.env.STOP_LEAD_HOURS ?? "24"} hours before each renewal. Change it with{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">STOP_LEAD_HOURS</code>.
          </p>
        </Card>
        <Card className="p-6">
          <CardTitle>Single-use cards</CardTitle>
          <p className="text-[16px] text-slate-700">
            Not connected. Kernel fills cards from a wallet provider. Link by Stripe issues a single-use card per approved purchase; it
            runs in live mode only and needs a US phone number. Until a card source is connected, sign-ups pause for you to enter a
            card in the live browser.
          </p>
        </Card>
      </div>
    </>
  );
}
