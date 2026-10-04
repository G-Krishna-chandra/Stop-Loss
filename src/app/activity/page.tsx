import Link from "next/link";
import { has } from "@/config";
import { listActiveRuns, listLedger } from "@/db";
import { dayTime } from "@/surface/format";
import { ServiceLogo } from "@/surface/ServiceLogo";
import { SetupNeeded } from "@/surface/SetupNeeded";
import { buttonClass, Card, PageHeader } from "@/surface/ui";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  if (!has("DATABASE_URL")) {
    return (
      <>
        <PageHeader title="Activity" subtitle="Every agent action and every decision you made, in order." />
        <SetupNeeded keys={["DATABASE_URL"]} what="The activity ledger" />
      </>
    );
  }
  const [ledger, active] = await Promise.all([listLedger(), listActiveRuns()]);
  return (
    <>
      <PageHeader title="Activity" subtitle="Every agent action and every decision you made, in order." />

      {active.length > 0 ? (
        <Card className="mb-6 p-6">
          <h2 className="mb-4 text-xl font-semibold text-slate-900">Running now</h2>
          <ul className="divide-y divide-slate-100">
            {active.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                <span className="text-[16px] text-slate-800">
                  {r.kind === "cancel" ? `Cancelling ${r.service_name}` : `Signing up for ${r.service_name}`}
                  <span className="ml-3 text-sm text-slate-500">started {dayTime(r.started_at)}</span>
                </span>
                <Link href={`/runs/${r.id}`} className={buttonClass.primary}>
                  Watch live
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        {ledger.length === 0 ? (
          <p className="px-6 py-14 text-center text-slate-500">Nothing has happened yet.</p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {ledger.map((e) => (
              <li key={e.id} className="flex items-start gap-4 px-6 py-4">
                {e.service_name && e.service_domain ? (
                  <ServiceLogo name={e.service_name} domain={e.service_domain} size="sm" />
                ) : (
                  <span className="h-10 w-10 shrink-0 rounded-xl bg-slate-100" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">
                    {e.title}
                    {e.service_name && e.position_id ? (
                      <Link href={`/positions/${e.position_id}`} className="ml-2 font-medium text-brand hover:underline">
                        {e.service_name}
                      </Link>
                    ) : null}
                  </div>
                  {e.detail ? <div className="mt-0.5 text-[15px] text-slate-500">{e.detail}</div> : null}
                </div>
                <time className="shrink-0 text-sm text-slate-500" dateTime={e.created_at}>
                  {dayTime(e.created_at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
