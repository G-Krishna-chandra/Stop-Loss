import { ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { has } from "@/config";
import { getStats, listPendingApprovals, listPositions, latestRunFor } from "@/db";
import { CancelButton } from "@/surface/CancelDialog";
import { cancelTargetFor } from "@/surface/cancelTarget";
import { day, money, price } from "@/surface/format";
import { ServiceLogo } from "@/surface/ServiceLogo";
import { SetupNeeded } from "@/surface/SetupNeeded";
import { SignupButton } from "@/surface/SignupDialog";
import { buttonClass, Card, PageHeader, StatCard, StatusPill } from "@/surface/ui";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  if (!has("DATABASE_URL")) {
    return (
      <>
        <PageHeader title="Positions" subtitle="Your trial subscriptions, tracked and protected." />
        <SetupNeeded keys={["DATABASE_URL"]} what="The positions ledger" />
      </>
    );
  }

  const [positions, stats, pending] = await Promise.all([listPositions(), getStats(), listPendingApprovals()]);
  const pendingBy = new Map(pending.map((a) => [a.position_id, a]));
  const runs = new Map(
    await Promise.all(
      positions
        .filter((p) => p.status === "approved" || p.status === "cancelling")
        .map(async (p) => [p.id, await latestRunFor(p.id)] as const),
    ),
  );

  return (
    <>
      <PageHeader
        title="Positions"
        subtitle="Your trial subscriptions, tracked and protected."
        actions={<SignupButton canRun={has("KERNEL_API_KEY")} />}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Current exposure"
          hint="Renewal prices of trials that are still open"
          value={
            <>
              {money(stats.exposure_cents)}
              <span className="text-[26px]">/mo</span>
            </>
          }
        />
        <StatCard label="Active trials" hint="Trials StopLoss is watching or cancelling" value={stats.active_trials} />
        <StatCard
          label="Action needed"
          hint="Stops waiting for your answer, and cancels that need review"
          value={stats.action_needed}
          tone={stats.action_needed > 0 ? "red" : "default"}
        />
        <StatCard label="Avoided so far" hint="Renewals cancelled before the first charge" value={money(stats.avoided_cents)} tone="green" />
      </div>

      <Card className="overflow-hidden">
        {positions.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <p className="text-lg font-semibold text-slate-900">No positions yet</p>
            <p className="mx-auto mt-2 max-w-md text-slate-500">
              Start a free trial with your StopLoss email. The welcome email opens a position here within a minute.
            </p>
            <Link href="/" className="mt-5 inline-block font-medium text-brand hover:underline">
              Get your StopLoss email
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-slate-200 text-sm text-slate-600">
                  {["Product", "Trial ends", "Renews at", "Status"].map((h) => (
                    <th key={h} scope="col" className="px-7 py-5 font-medium">
                      <span className="inline-flex items-center gap-1">
                        {h}
                        <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      </span>
                    </th>
                  ))}
                  <th scope="col" className="px-7 py-5 font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {positions.map((p) => {
                  const approval = pendingBy.get(p.id);
                  const run = runs.get(p.id);
                  return (
                    <tr key={p.id} className="text-[16px]">
                      <td className="px-7 py-5">
                        <Link href={`/positions/${p.id}`} className="flex items-center gap-4">
                          <ServiceLogo name={p.service_name} domain={p.service_domain} />
                          <span>
                            <span className="block font-semibold text-slate-900">{p.service_name}</span>
                            <span className="block text-sm text-slate-500">{p.product_blurb ?? p.service_domain}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-7 py-5 text-slate-800">{p.renewal_date ? day(p.renewal_date) : "Reading terms…"}</td>
                      <td className="px-7 py-5 text-slate-800">
                        {p.renewal_price_cents == null ? "Unknown" : price(p.renewal_price_cents, p.currency, p.billing_period)}
                      </td>
                      <td className="px-7 py-5">
                        <StatusPill status={p.status} />
                      </td>
                      <td className="px-7 py-5">
                        {approval ? (
                          <CancelButton
                            target={cancelTargetFor(p, approval)}
                            label="Review"
                            className={buttonClass.primary + " min-w-[106px]"}
                          />
                        ) : run && (p.status === "approved" || p.status === "cancelling") ? (
                          <Link href={`/runs/${run.id}`} className={buttonClass.primary + " min-w-[106px]"}>
                            Watch
                          </Link>
                        ) : (
                          <Link href={`/positions/${p.id}`} className={buttonClass.outlineBlue + " min-w-[106px]"}>
                            View
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
