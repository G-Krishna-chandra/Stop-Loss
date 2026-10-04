import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe,
  Info,
  Mail,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { has } from "@/config";
import { emailsForPosition, getEmail, getPosition, latestRunFor, listEvents, pendingApprovalFor } from "@/db";
import { getMessage } from "@/inbox";
import { CancelButton } from "@/surface/CancelDialog";
import { cancelTargetFor } from "@/surface/cancelTarget";
import { day, dayTime, money, price } from "@/surface/format";
import { ServiceLogo } from "@/surface/ServiceLogo";
import { SetupNeeded } from "@/surface/SetupNeeded";
import { Trace } from "@/surface/Timeline";
import { buttonClass, Card, CardTitle, DetailRows, StatusPill } from "@/surface/ui";
import type { Position } from "@/types";

export const dynamic = "force-dynamic";

const TABS = ["overview", "evidence", "activity"] as const;
type Tab = (typeof TABS)[number];

function trialLength(p: Position): string {
  if (!p.terms_checked_at) return "Reading terms…";
  if (p.has_trial === false) return "No free trial";
  return p.trial_days != null ? `${p.trial_days} days` : "Not found";
}

function origin(p: Position): string {
  if (p.created_by === "signup_run") return "Created by StopLoss sign-up workflow";
  if (p.created_by === "manual") return "Added by you";
  return "Detected from welcome email";
}

async function proofBody(messageId: string | null): Promise<{ text: string; from: string; at: string; subject: string } | null> {
  if (!messageId) return null;
  const record = await getEmail(messageId);
  if (has("AGENTMAIL_API_KEY")) {
    try {
      const m = await getMessage(messageId);
      return { text: m.text, from: m.from, at: m.received_at, subject: m.subject };
    } catch {
      // Fall through to the stored preview.
    }
  }
  return record ? { text: record.preview, from: record.from_address, at: record.received_at, subject: record.subject } : null;
}

export default async function PositionPage({ params, searchParams }: PageProps<"/positions/[id]">) {
  if (!has("DATABASE_URL")) return <SetupNeeded keys={["DATABASE_URL"]} what="The positions ledger" />;
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";

  const position = await getPosition(id);
  if (!position) notFound();
  const [events, emails, pending, run] = await Promise.all([
    listEvents(id),
    emailsForPosition(id),
    pendingApprovalFor(id),
    latestRunFor(id),
  ]);
  const noTrial = position.has_trial === false;
  const canCancel = !noTrial && ["open", "stop_pending", "failed"].includes(position.status);
  const target = cancelTargetFor(position, pending);
  const trace = events.map((e) => ({ id: e.id, title: e.title, detail: e.detail, at: e.created_at }));

  return (
    <div className="max-w-[1180px]">
      <Link href="/positions" className="inline-flex items-center gap-2 text-[16px] text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        Back to positions
      </Link>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-5">
        <div className="flex items-center gap-6">
          <ServiceLogo name={position.service_name} domain={position.service_domain} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[40px] font-bold leading-tight tracking-tight text-slate-900">{position.service_name}</h1>
              <StatusPill status={position.status} large />
            </div>
            <p className="mt-1 text-lg text-slate-500">{position.product_blurb ?? origin(position)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={`https://${position.service_domain}`} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
            <ExternalLink className="h-5 w-5" aria-hidden="true" />
            Open in browser
          </a>
          {canCancel ? (
            <CancelButton
              target={target}
              label={position.status === "failed" ? "Try cancelling again" : position.status === "stop_pending" ? "Review cancel" : "Cancel subscription"}
              className={buttonClass.danger}
              icon={<Ban className="h-5 w-5" aria-hidden="true" />}
            />
          ) : null}
        </div>
      </div>

      <StatusBanner position={position} runId={run?.id ?? null} replayUrl={run?.replay_url ?? null} />

      <nav className="mt-8 flex gap-2 border-b border-slate-200" aria-label="Position sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === "overview" ? `/positions/${id}` : `/positions/${id}?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={clsx(
              "-mb-px border-b-2 px-6 pb-3 text-[17px] font-medium capitalize",
              tab === t ? "border-brand text-brand" : "border-transparent text-slate-600 hover:text-slate-900",
            )}
          >
            {t}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        position.status === "closed" ? (
          <ClosedOverview position={position} trace={trace} runReplay={run?.replay_url ?? null} />
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <CardTitle icon={FileText}>Trial details</CardTitle>
              <DetailRows
                rows={[
                  ["Plan", noTrial ? "Free plan" : (position.plan_name ?? "Unknown")],
                  ["Trial length", trialLength(position)],
                  ["Renews on", noTrial ? "Nothing renews" : position.renewal_date ? day(position.renewal_date) : "Unknown"],
                  [
                    noTrial ? "Paid plan" : "Price",
                    position.renewal_price_cents == null ? "Unknown" : price(position.renewal_price_cents, position.currency, position.billing_period),
                  ],
                  ["Card", position.card_last4 ? `•••• ${position.card_last4}` : "Your own card"],
                ]}
              />
            </Card>
            <Card className="p-6">
              <CardTitle icon={CalendarDays}>Upcoming renewal</CardTitle>
              {noTrial ? (
                <>
                  <div className="text-[32px] font-bold tracking-tight text-slate-900">No renewal</div>
                  <p className="mt-1 text-[17px] text-slate-500">
                    This account is on a free plan, so nothing renews and there is nothing at risk.
                  </p>
                </>
              ) : !position.renewal_date ? (
                <>
                  <div className="text-[32px] font-bold tracking-tight text-slate-900">
                    {position.terms_checked_at ? "Unknown" : "Reading terms…"}
                  </div>
                  <p className="mt-1 text-[17px] text-slate-500">
                    {position.terms_checked_at
                      ? "StopLoss couldn’t find when this trial ends, so no stop is set yet."
                      : "StopLoss is reading the trial terms."}
                  </p>
                </>
              ) : (
                <>
              <div className="text-[32px] font-bold tracking-tight text-slate-900">{day(position.renewal_date)}</div>
              <p className="mt-1 text-[17px] text-slate-500">Your trial will convert to a paid subscription.</p>
              <div className="mt-5 flex gap-4 rounded-xl bg-blue-50 p-5">
                <Info className="mt-0.5 h-6 w-6 shrink-0 text-brand" aria-hidden="true" />
                <div>
                  <div className="font-semibold text-blue-800">StopLoss will ask before cancelling.</div>
                  <p className="mt-1 text-[15px] text-slate-600">
                    {position.stop_at ? `The stop is set for ${dayTime(position.stop_at)}. ` : ""}When it’s time, we’ll confirm with you
                    before taking action.
                  </p>
                </div>
              </div>
              <div className="mt-5 border-t border-slate-100 pt-4">
                <DetailRows rows={[["Renews at", price(position.renewal_price_cents, position.currency, position.billing_period)]]} />
              </div>
                </>
              )}
            </Card>
            <Card className="p-6">
              <CardTitle icon={Mail}>Source emails</CardTitle>
              <EmailList emails={emails} />
            </Card>
            <Card className="p-6">
              <CardTitle icon={Activity}>Activity trace</CardTitle>
              <Trace items={trace.slice(-4)} times={dayTime} />
            </Card>
          </div>
        )
      ) : null}

      {tab === "evidence" ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <CardTitle icon={Mail}>Emails</CardTitle>
            <EmailList emails={emails} />
          </Card>
          <Card className="p-6">
            <CardTitle icon={Globe}>Research sources</CardTitle>
            {position.source_urls.length === 0 ? (
              <p className="text-slate-500">No sources yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {position.source_urls.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer" className="break-all text-[15px] text-brand hover:underline">
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {position.cancel_policy ? <p className="mt-5 text-[15px] text-slate-600">{position.cancel_policy}</p> : null}
          </Card>
          {run ? (
            <Card className="p-6 lg:col-span-2">
              <CardTitle icon={RotateCcw}>Browser sessions</CardTitle>
              <div className="flex flex-wrap items-center gap-4 text-[15px] text-slate-700">
                <span>
                  {run.kind === "cancel" ? "Cancel" : "Sign-up"} run · {dayTime(run.started_at)} · {run.status}
                </span>
                <Link href={`/runs/${run.id}`} className="font-medium text-brand hover:underline">
                  Open run
                </Link>
                {run.replay_url ? (
                  <a href={run.replay_url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                    View replay
                  </a>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "activity" ? (
        <Card className="mt-6 p-6">
          <CardTitle icon={Activity}>Everything StopLoss did</CardTitle>
          <Trace items={trace} times={dayTime} />
        </Card>
      ) : null}
    </div>
  );
}

function EmailList({ emails }: { emails: Awaited<ReturnType<typeof emailsForPosition>> }) {
  if (emails.length === 0) return <p className="text-slate-500">No emails yet.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {emails.map((e) => (
        <li key={e.message_id}>
          <Link href={`/inbox?m=${encodeURIComponent(e.message_id)}`} className="flex items-center gap-4 py-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-slate-700">
              <Mail className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-900">{e.subject}</span>
              <span className="block truncate text-[15px] text-slate-500">From: {e.from_address}</span>
            </span>
            <span className="shrink-0 text-[15px] text-slate-600">{day(e.received_at)}</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StatusBanner({ position, runId, replayUrl }: { position: Position; runId: string | null; replayUrl: string | null }) {
  if (position.status === "closed") {
    return (
      <div className="mt-8 grid gap-6 rounded-2xl border border-emerald-300 bg-emerald-50/70 p-7 md:grid-cols-[1fr_auto_auto] md:items-center">
        <div className="flex items-center gap-5">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" aria-hidden="true" />
          </span>
          <div>
            <div className="text-2xl font-semibold text-slate-900">Cancellation confirmed</div>
            <div className="mt-1 text-[17px] text-slate-600">Your subscription has been cancelled.</div>
          </div>
        </div>
        <div className="border-emerald-200 md:border-l md:px-10">
          <div className="text-[15px] text-slate-600">Ended on</div>
          <div className="mt-1 text-[28px] font-bold text-slate-900">{day(position.closed_at)}</div>
        </div>
        <div className="border-emerald-200 md:border-l md:px-10">
          <div className="text-[15px] text-slate-600">Saved</div>
          <div className="mt-1 text-[32px] font-bold text-emerald-600">
            {price(position.renewal_price_cents, position.currency, position.billing_period)}
          </div>
        </div>
      </div>
    );
  }
  if (position.status === "approved" || position.status === "cancelling") {
    return (
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-6">
        <div className="text-[17px] text-slate-800">StopLoss is cancelling {position.service_name} in a live browser.</div>
        {runId ? (
          <Link href={`/runs/${runId}`} className={buttonClass.primary}>
            Watch it live
          </Link>
        ) : null}
      </div>
    );
  }
  if (position.status === "failed") {
    return (
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <div className="flex gap-4">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <div className="font-semibold text-slate-900">StopLoss couldn’t confirm the cancel</div>
            <p className="mt-1 text-[15px] text-slate-600">
              {position.status_reason ?? "The result was unclear."} StopLoss did not retry on its own. Still at risk:{" "}
              {money(position.renewal_price_cents, position.currency)} on {day(position.renewal_date)}.
            </p>
          </div>
        </div>
        {replayUrl ? (
          <a href={replayUrl} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
            Watch the replay
          </a>
        ) : null}
      </div>
    );
  }
  if (position.status === "kept") {
    return (
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-[17px] text-slate-700">
        You’re keeping {position.service_name}. It renews on {day(position.renewal_date)} for{" "}
        {price(position.renewal_price_cents, position.currency, position.billing_period)}. StopLoss won’t touch it again.
      </div>
    );
  }
  return null;
}

async function ClosedOverview({
  position,
  trace,
  runReplay,
}: {
  position: Position;
  trace: { id: string; title: string; detail: string | null; at: string }[];
  runReplay: string | null;
}) {
  const proof = await proofBody(position.evidence_email_id);
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <Card className="p-6">
        <CardTitle
          icon={undefined}
          aside={null}
        >
          <span className="flex items-center gap-3">
            Proof email
            <Mail className="h-5 w-5 text-slate-600" aria-hidden="true" />
            <span className="rounded-full bg-emerald-50 px-3 py-0.5 text-sm font-medium text-emerald-700">Verified</span>
          </span>
        </CardTitle>
        {proof ? (
          <>
            <p className="-mt-2 mb-5 text-[16px] text-slate-500">We received a confirmation email from {position.service_name}.</p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ServiceLogo name={position.service_name} domain={position.service_domain} size="sm" />
                  <div>
                    <div className="font-semibold text-slate-900">{position.service_name}</div>
                    <div className="text-sm text-slate-500">{proof.from}</div>
                  </div>
                </div>
                <div className="text-sm text-slate-500">{dayTime(proof.at)}</div>
              </div>
              <div className="mt-4 border-t border-slate-200 pt-4 text-[15px]">
                <span className="text-slate-500">Subject: </span>
                <span className="text-slate-900">{proof.subject}</span>
              </div>
              <div className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-5 text-[15px] leading-relaxed text-slate-800">
                {proof.text}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Link href={`/inbox?m=${encodeURIComponent(position.evidence_email_id ?? "")}`} className={buttonClass.secondary}>
                <ExternalLink className="h-5 w-5" aria-hidden="true" />
                View email
              </Link>
              {runReplay ? (
                <a href={runReplay} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
                  <RotateCcw className="h-5 w-5" aria-hidden="true" />
                  View replay
                </a>
              ) : (
                <span className={buttonClass.secondary + " cursor-default text-slate-400"}>No replay</span>
              )}
            </div>
          </>
        ) : (
          <p className="text-slate-500">The proof email is not available.</p>
        )}
      </Card>
      <div className="flex flex-col gap-6">
        <Card className="p-6">
          <CardTitle>Activity summary</CardTitle>
          <p className="-mt-2 mb-5 text-[16px] text-slate-500">Here’s what happened.</p>
          <Trace items={trace.slice(-3)} times={dayTime} />
        </Card>
        <Card className="p-6">
          <CardTitle>Subscription details</CardTitle>
          <DetailRows
            rows={[
              ["Plan", position.plan_name ?? "Unknown"],
              ["Price", price(position.renewal_price_cents, position.currency, position.billing_period)],
              ["Started", day(position.opened_at)],
              ["Ended on", day(position.closed_at)],
              ["Status", <StatusPill key="s" status={position.status} />],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
