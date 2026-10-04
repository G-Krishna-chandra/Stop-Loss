import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getCardStatus } from "@/cards";
import { has } from "@/config";
import { stopLossAddress } from "@/inbox";
import { CopyButton } from "@/surface/CopyButton";
import { CardArt, EnvelopeArt, HeroArt, ToggleArt, TrackArt } from "@/surface/home/HomeArt";
import { buttonClass, Card, Eyebrow, linkClass } from "@/surface/ui";

export const dynamic = "force-dynamic";

async function address(): Promise<string | null> {
  if (!has("AGENTMAIL_API_KEY")) return null;
  try {
    return await stopLossAddress();
  } catch {
    return null;
  }
}

function Step({ n, art, title, body }: { n: number; art: ReactNode; title: string; body: string }) {
  return (
    <Card className="flex flex-col p-6">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-ink">{n}</span>
      <div className="-mx-6 flex h-[176px] items-center justify-center overflow-hidden px-6">{art}</div>
      <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{body}</p>
    </Card>
  );
}

export default async function HomePage() {
  const [email, card] = await Promise.all([address(), getCardStatus().catch(() => null)]);
  const cardsOn = card?.state === "connected";

  return (
    <div className="mx-auto max-w-[1280px]">
      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)]">
        <div className="min-w-0">
          <Eyebrow>Trials without surprises</Eyebrow>
          <h1 className="mt-5 text-[44px] font-bold leading-[1.02] tracking-[-0.045em] text-ink sm:text-[58px] xl:text-[68px]">
            Try software without surprise charges.
          </h1>
          <p className="mt-6 max-w-[560px] text-[19px] leading-relaxed text-muted">
            Use your StopLoss email and a single-use virtual card to start trials. We track the renewal, protect your downside, and ask
            before cancelling.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/positions" className={buttonClass.primary + " px-7 py-3.5 text-base"}>
              Get started
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
            <a href="#how" className={buttonClass.secondary + " px-7 py-3.5 text-base"}>
              See how it works
            </a>
          </div>

          <div className="mt-10 max-w-[560px] rounded-2xl border border-line bg-white p-4 shadow-soft">
            <div className="text-[12px] font-medium uppercase tracking-[0.18em] text-muted">Your StopLoss email</div>
            {email ? (
              <div className="mt-2 flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate font-mono text-[16px] text-ink">{email}</span>
                <CopyButton value={email} compact />
              </div>
            ) : (
              <p className="mt-2 text-[15px] text-muted">
                Add <code className="font-mono text-sm">AGENTMAIL_API_KEY</code> to create your address.
              </p>
            )}
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[14px]">
              <span className={cardsOn ? "h-2 w-2 rounded-full bg-emerald-500" : "h-2 w-2 rounded-full bg-neutral-300"} aria-hidden="true" />
              {cardsOn ? (
                <span className="text-ink">Single-use cards on</span>
              ) : (
                <Link href="/settings#cards" className={linkClass}>
                  Connect your Link wallet
                </Link>
              )}
            </div>
          </div>
        </div>
        <HeroArt email={email} />
      </section>

      <section id="how" className="mt-16 grid scroll-mt-24 grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Step n={1} art={<EnvelopeArt email={email} />} title="Use your StopLoss email" body="Sign up for trials with your unique StopLoss email address." />
        <Step
          n={2}
          art={<CardArt />}
          title="We provide a virtual card"
          body="Each trial StopLoss signs up for gets its own single-use card, so a renewal has nothing to charge."
        />
        <Step n={3} art={<TrackArt />} title="We track the trial" body="We monitor renewal dates, pricing, and subscription details." />
        <Step n={4} art={<ToggleArt />} title="We ask before cancelling" body="Before you’re charged, we’ll ask you once and give you a chance to keep it." />
      </section>
    </div>
  );
}
