import clsx from "clsx";
import { CheckCircle2, ExternalLink, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { has } from "@/config";
import { getPosition, listEmails } from "@/db";
import { getMessage, listInbox, parseSender, serviceName, stopLossAddress } from "@/inbox";
import { day, dayTime, inboxStamp, price } from "@/surface/format";
import { ServiceLogo } from "@/surface/ServiceLogo";
import { SetupNeeded } from "@/surface/SetupNeeded";
import { Card, PageHeader, Pill } from "@/surface/ui";
import type { EmailAction, EmailCategory, InboxEmail } from "@/types";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unprocessed", label: "Unprocessed" },
  { key: "position", label: "Position created" },
  { key: "billing", label: "Billing" },
  { key: "codes", label: "Login codes" },
  { key: "proof", label: "Cancellation" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

type Row = {
  message_id: string;
  from: string;
  name: string;
  domain: string;
  subject: string;
  preview: string;
  received_at: string;
  record: InboxEmail | null;
};

function badge(record: InboxEmail | null): { label: string; tone: "green" | "blue" | "violet" | "amber" | "slate" } {
  if (!record) return { label: "Unprocessed", tone: "slate" };
  const byAction: Partial<Record<EmailAction, { label: string; tone: "green" | "blue" | "violet" | "amber" | "slate" }>> = {
    position_created: { label: "Position created", tone: "green" },
    terms_updated: { label: "Terms updated", tone: "green" },
    stop_triggered: { label: "Renewal reminder", tone: "amber" },
    proof_received: { label: "Proof received", tone: "green" },
    login_code: { label: "Login code", tone: "blue" },
  };
  const byCategory: Record<EmailCategory, { label: string; tone: "green" | "blue" | "violet" | "amber" | "slate" }> = {
    welcome: { label: "Trial", tone: "blue" },
    receipt: { label: "Billing", tone: "violet" },
    login_code: { label: "Login code", tone: "blue" },
    trial_ending: { label: "Renewal reminder", tone: "amber" },
    cancellation: { label: "Cancellation", tone: "green" },
    account_setup: { label: "Account setup", tone: "blue" },
    other: { label: "General", tone: "slate" },
  };
  return byAction[record.action] ?? byCategory[record.category];
}

function matches(f: Filter, r: Row): boolean {
  const rec = r.record;
  switch (f) {
    case "all":
      return true;
    case "unprocessed":
      return !rec;
    case "position":
      return rec?.action === "position_created";
    case "billing":
      return rec?.category === "receipt";
    case "codes":
      return rec?.category === "login_code";
    case "proof":
      return rec?.category === "cancellation";
  }
}

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const header = <PageHeader title="Inbox" subtitle="Emails from your StopLoss address, organized into positions." />;
  if (!has("AGENTMAIL_API_KEY")) {
    return (
      <>
        {header}
        <SetupNeeded keys={["AGENTMAIL_API_KEY"]} what="The inbox" />
      </>
    );
  }
  const sp = await searchParams;
  const filter: Filter = FILTERS.some((f) => f.key === sp.f) ? (sp.f as Filter) : "all";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  const [address, items, records] = await Promise.all([
    stopLossAddress(),
    listInbox(100),
    has("DATABASE_URL") ? listEmails(200) : Promise.resolve([] as InboxEmail[]),
  ]);
  const byId = new Map(records.map((r) => [r.message_id, r]));
  const rows: Row[] = items
    .map((m) => {
      const sender = parseSender(m.from);
      return {
        message_id: m.message_id,
        from: sender.address,
        name: serviceName(sender),
        domain: sender.domain,
        subject: m.subject,
        preview: m.preview,
        received_at: m.received_at,
        record: byId.get(m.message_id) ?? null,
      };
    })
    .filter((r) => matches(filter, r))
    .filter((r) => !q || `${r.name} ${r.subject} ${r.preview} ${r.from}`.toLowerCase().includes(q));

  const selectedId = typeof sp.m === "string" ? sp.m : rows[0]?.message_id;
  const selectedRow = rows.find((r) => r.message_id === selectedId) ?? null;
  const message = selectedId ? await getMessage(selectedId).catch(() => null) : null;
  const record = selectedId ? byId.get(selectedId) ?? null : null;
  const linked = record?.position_id && has("DATABASE_URL") ? await getPosition(record.position_id) : null;
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const next = { f: filter === "all" ? undefined : filter, q: q || undefined, m: selectedId, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/inbox?${s}` : "/inbox";
  };

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Emails from your StopLoss address, organized into positions."
        actions={
          <form action="/inbox" className="relative w-[320px] max-w-full">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <label htmlFor="inbox-q" className="sr-only">
              Search emails
            </label>
            <input
              id="inbox-q"
              name="q"
              defaultValue={q}
              placeholder="Search emails..."
              className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-12 pr-4 text-[15px] outline-none focus:border-brand"
            />
            {filter !== "all" ? <input type="hidden" name="f" value={filter} /> : null}
          </form>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,490px)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="flex gap-2 overflow-x-auto border-b border-slate-200 p-4">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href({ f: f.key === "all" ? undefined : f.key, m: undefined })}
                className={clsx(
                  "shrink-0 rounded-lg border px-4 py-1.5 text-sm font-medium",
                  filter === f.key ? "border-blue-200 bg-blue-50 text-brand" : "border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                {f.label}
              </Link>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-slate-500">
              {items.length === 0 ? `No mail yet. Start a trial with ${address}.` : "No emails match."}
            </p>
          ) : (
            <ul className="max-h-[72vh] divide-y divide-slate-200 overflow-y-auto">
              {rows.map((r) => {
                const b = badge(r.record);
                return (
                  <li key={r.message_id}>
                    <Link
                      href={href({ m: r.message_id })}
                      aria-current={r.message_id === selectedId ? "true" : undefined}
                      className={clsx("flex gap-4 px-5 py-4", r.message_id === selectedId ? "bg-blue-50/70" : "hover:bg-slate-50")}
                    >
                      <ServiceLogo name={r.name} domain={r.domain} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <span className="truncate font-semibold text-slate-900">{r.name}</span>
                          <span className="shrink-0 text-sm text-slate-500">{inboxStamp(r.received_at)}</span>
                        </div>
                        <div className="mt-0.5 flex items-start justify-between gap-3">
                          <span className="truncate text-[15px] text-slate-800">{r.subject}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-3">
                          <span className="truncate text-sm text-slate-500">{r.preview}</span>
                          <Pill tone={b.tone}>{b.label}</Pill>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="min-w-0 p-6">
          {message && selectedRow ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <ServiceLogo name={selectedRow.name} domain={selectedRow.domain} />
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{selectedRow.name}</div>
                    <div className="text-[15px] text-slate-500">to {message.to.join(", ") || address}</div>
                  </div>
                </div>
                <span className="text-[15px] text-slate-500">{dayTime(message.received_at)}</span>
              </div>
              <h2 className="mt-6 text-[28px] font-bold tracking-tight text-slate-900">{message.subject}</h2>
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-100">
                {message.html ? (
                  <iframe
                    title={`Email: ${message.subject}`}
                    sandbox=""
                    srcDoc={message.html}
                    className="block h-[420px] w-full bg-white"
                  />
                ) : (
                  <div className="max-h-[420px] overflow-auto whitespace-pre-wrap p-5 text-[16px] leading-relaxed text-slate-800">
                    {message.text}
                  </div>
                )}
              </div>
              <Extracted record={record} linkedName={linked?.service_name ?? null} positionId={linked?.id ?? null} />
            </>
          ) : (
            <p className="py-16 text-center text-slate-500">Select an email.</p>
          )}
        </Card>
      </div>
    </>
  );
}

function Extracted({ record, linkedName, positionId }: { record: InboxEmail | null; linkedName: string | null; positionId: string | null }) {
  if (!record) {
    return (
      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-[15px] text-slate-600">
        StopLoss hasn’t processed this email. It only acts on mail that arrives through the webhook.
      </div>
    );
  }
  const x = record.extracted;
  const b = badge(record);
  const fields: [string, string][] = [];
  if (x.trial_days != null) fields.push(["Trial length", `${x.trial_days} days`]);
  if (x.renewal_price_cents != null) fields.push(["Renewal price", price(x.renewal_price_cents, x.currency ?? "USD", x.billing_period)]);
  if (x.renewal_date) fields.push(["Renewal date", day(x.renewal_date)]);
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-emerald-200">
      <div className="flex items-center justify-between gap-3 bg-emerald-50/60 px-5 py-4">
        <div className="flex items-center gap-3 font-semibold text-slate-900">
          <Sparkles className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          StopLoss extracted
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {b.label}
        </span>
      </div>
      <div className="grid gap-x-8 gap-y-4 px-5 py-5 sm:grid-cols-2">
        {fields.map(([k, v]) => (
          <div key={k}>
            <div className="text-sm text-slate-500">{k}</div>
            <div className="mt-0.5 font-semibold text-slate-900">{v}</div>
          </div>
        ))}
        {x.cancel_url ? (
          <div>
            <div className="text-sm text-slate-500">Cancel path</div>
            <a href={x.cancel_url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1.5 break-all font-medium text-brand hover:underline">
              {x.cancel_url.replace(/^https?:\/\//, "")}
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          </div>
        ) : null}
        <div>
          <div className="text-sm text-slate-500">Position</div>
          {positionId ? (
            <Link href={`/positions/${positionId}`} className="mt-0.5 inline-block font-medium text-brand hover:underline">
              {linkedName}
            </Link>
          ) : (
            <div className="mt-0.5 font-medium text-slate-700">None</div>
          )}
        </div>
      </div>
    </div>
  );
}
