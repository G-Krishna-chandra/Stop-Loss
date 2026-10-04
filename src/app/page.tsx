import { ArrowRight, Bell, CreditCard, Eye, FileText, Info, Mail } from "lucide-react";
import Link from "next/link";
import { has } from "@/config";
import { stopLossAddress } from "@/inbox";
import { CopyButton } from "@/surface/CopyButton";
import { buttonClass, Card } from "@/surface/ui";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Mail, title: "Use your StopLoss email", body: "Sign up for trials with your unique StopLoss email address." },
  { icon: Eye, title: "We watch the trial", body: "We track the renewal date, pricing, and subscription details." },
  { icon: Bell, title: "We ask before cancelling", body: "Before you're charged, we'll ask you once and give you a chance to keep it." },
  { icon: FileText, title: "We send proof", body: "The service's cancellation email becomes the proof that closes the trial." },
];

async function address(): Promise<string | null> {
  if (!has("AGENTMAIL_API_KEY")) return null;
  try {
    return await stopLossAddress();
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const email = await address();
  return (
    <div className="max-w-[1180px]">
      <h1 className="max-w-[640px] text-[44px] font-bold leading-[1.08] tracking-tight text-slate-900 md:text-[56px]">
        Try software without surprise charges.
      </h1>
      <p className="mt-5 max-w-[660px] text-xl leading-relaxed text-slate-500">
        Use your StopLoss email when you start a free trial. We track the renewal, protect your downside, and ask
        before cancelling.
      </p>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
        <ol className="relative flex flex-col gap-10">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="relative flex gap-6">
              {i < STEPS.length - 1 ? (
                <span className="absolute left-8 top-16 h-[calc(100%-1rem)] border-l border-dashed border-slate-300" aria-hidden="true" />
              ) : null}
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-brand">
                <Icon className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="mt-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                {i + 1}
              </span>
              <div className="mt-1.5">
                <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
                <p className="mt-1 max-w-sm text-[17px] leading-relaxed text-slate-500">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-6">
          <Card className="p-7">
            <div className="flex gap-5">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-brand">
                <Mail className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div>
                <h2 className="flex items-center gap-2 text-[22px] font-semibold text-slate-900">
                  Your StopLoss email
                  <span title="Every trial you start with this address is tracked." className="text-slate-400">
                    <Info className="h-5 w-5" aria-label="Every trial you start with this address is tracked." />
                  </span>
                </h2>
                <p className="mt-1 text-[16px] text-slate-500">Use this email when you start a free trial.</p>
              </div>
            </div>
            {email ? (
              <div className="mt-6 flex gap-3">
                <div className="flex min-w-0 flex-1 items-center rounded-lg bg-slate-100 px-5 py-3 text-[19px] text-slate-900">
                  <span className="truncate">{email}</span>
                </div>
                <CopyButton value={email} />
              </div>
            ) : (
              <p className="mt-6 rounded-lg bg-amber-50 px-5 py-4 text-[15px] text-amber-900">
                Add <code className="font-mono text-sm">AGENTMAIL_API_KEY</code> to <code className="font-mono text-sm">.env.local</code> and
                StopLoss creates your address on the next page load.
              </p>
            )}
          </Card>

          <Card className="p-7">
            <div className="flex gap-5">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-brand">
                <CreditCard className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-[22px] font-semibold text-slate-900">Single-use virtual card</h2>
                <p className="mt-1 text-[16px] text-slate-500">A new card for each trial StopLoss signs up for.</p>
              </div>
            </div>
            <p className="mt-6 rounded-lg bg-slate-100 px-5 py-4 text-[15px] text-slate-600">
              No card source connected yet. Kernel fills cards from a wallet provider such as Link by Stripe.
            </p>
            <Link href="/settings" className="mt-3 inline-block text-[15px] font-medium text-brand hover:underline">
              Card settings
            </Link>
          </Card>
        </div>
      </div>

      <Link href="/positions" className={buttonClass.primary + " mt-12 px-20 py-4 text-lg"}>
        Get started
        <ArrowRight className="h-5 w-5" aria-hidden="true" />
      </Link>
    </div>
  );
}
