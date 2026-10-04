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
    <Card className="relative flex flex-col p-5 2xl:p-6">
      <span className="absolute left-5 top-5 flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-ink 2xl:left-6 2xl:top-6">
        {n}
      </span>
      <div className="-mx-6 flex h-[128px] items-center justify-center overflow-hidden px-6 2xl:h-[190px]">{art}</div>
      <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">{body}</p>
    </Card>
  );
}

export default async function HomePage() {
  const [email, card] = await Promise.all([address(), getCardStatus().catch(() => null)]);
  const cardsOn = card?.state === "connected";

  return (
    <div className="flex w-full flex-col justify-center lg:min-h-[calc(100dvh-8rem)]">
      <section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Eyebrow>Trials without surprises</Eyebrow>
          <h1 className="mt-3 text-balance text-[42px] font-bold leading-[1.02] tracking-[-0.045em] text-ink sm:text-[52px] xl:text-[60px] 2xl:text-[76px] 3xl:text-[92px]">
            Try software without surprise charges.
          </h1>
          <p className="mt-4 max-w-[640px] text-[17px] leading-relaxed text-muted 2xl:max-w-[720px] 2xl:text-[19px]">
            Use your StopLoss email and a single-use virtual card to start trials. We track the renewal, protect your downside, and ask
            before cancelling.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/positions" className={buttonClass.primary + " px-7 py-3.5 text-base"}>
              Get started
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
            <a href="#how" className={buttonClass.secondary + " px-7 py-3.5 text-base"}>
              See how it works
            </a>
          </div>

          <div className="mt-6 flex max-w-[640px] flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-white p-4 shadow-soft">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium uppercase tracking-[0.18em] text-muted">Your StopLoss email</div>
              {email ? (
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-[16px] text-ink">{email}</span>
                  <CopyButton value={email} compact />
                </div>
              ) : (
                <p className="mt-1.5 text-[15px] text-muted">
                  Add <code className="font-mono text-sm">AGENTMAIL_API_KEY</code> to create your address.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 text-[14px] sm:self-end sm:pb-2">
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
        {/* The illustration is drawn at a fixed size; it grows with the screen so wide displays don't leave a gap. */}
        <div className="hidden justify-center lg:flex">
          <div className="origin-top scale-[0.92] -mb-[35px] 2xl:mb-[44px] 2xl:scale-110 3xl:mb-[132px] 3xl:scale-[1.3]">
            <HeroArt email={email} />
          </div>
        </div>
      </section>

      <section id="how" className="mt-8 grid scroll-mt-24 grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4 2xl:mt-14 2xl:gap-6">
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
