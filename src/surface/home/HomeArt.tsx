// CSS-only illustrations for the home page: tilted glass cards, an envelope, a virtual card, and a toggle.
// Decorative: every piece is aria-hidden. The service cards are examples, not the user's data.
import clsx from "clsx";
import { CreditCard } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { ServiceLogo } from "../ServiceLogo";

const tilt = (y: number, x: number, z = 0): CSSProperties => ({
  transform: `perspective(1400px) rotateY(${y}deg) rotateX(${x}deg) rotateZ(${z}deg)`,
});

function StatusChip({ tone, children }: { tone: "green" | "blue" | "amber"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tone === "green" && "bg-emerald-50 text-emerald-700 ring-emerald-100",
        tone === "blue" && "bg-sky-50 text-sky-800 ring-sky-100",
        tone === "amber" && "bg-amber-50 text-amber-800 ring-amber-100",
      )}
    >
      {children}
    </span>
  );
}

const EXAMPLES = [
  { name: "ChatGPT Plus", domain: "chatgpt.com", status: "Tracking", tone: "green" as const, renews: "Renews in 6 days", shift: 0 },
  { name: "Cursor Pro", domain: "cursor.com", status: "Watching", tone: "blue" as const, renews: "Renews in 12 days", shift: 18 },
  { name: "Perplexity Pro", domain: "perplexity.ai", status: "Stop pending", tone: "amber" as const, renews: "Renews tomorrow", shift: 36 },
];

export function HeroArt({ email }: { email: string | null }) {
  return (
    <div className="relative h-[440px] w-[520px] max-w-full select-none" aria-hidden="true">
      <div className="absolute inset-0 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_60%_40%,#ffffff_0%,#f1f1ef_55%,transparent_100%)]" />

      {/* Signup form StopLoss fills in for you */}
      <div className="glass absolute left-0 top-[110px] w-[236px] rounded-2xl p-5" style={tilt(20, 6, -3)}>
        <div className="mx-auto w-fit">
          <ServiceLogo name="ChatGPT" domain="chatgpt.com" size="sm" />
        </div>
        <p className="mt-3 text-center text-[14px] font-semibold text-ink">Create your account</p>
        <div className="mt-4 truncate rounded-lg border border-line bg-white/80 px-3 py-2.5 font-mono text-[11px] text-ink">
          {email ?? "you@stoploss.email"}
        </div>
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-line bg-white/80 px-3 py-2">
          <CreditCard className="h-3.5 w-3.5 text-neutral-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[9px] uppercase tracking-wider text-neutral-500">Card number</div>
            <div className="font-mono text-[11px] tracking-widest text-ink">•••• •••• ••••</div>
          </div>
          <span className="font-mono text-[11px] text-ink">4242</span>
        </div>
        <div className="mt-4 rounded-lg bg-ink py-2.5 text-center text-[12px] font-semibold text-white shadow-[0_8px_18px_-8px_rgb(17_17_17/0.6)]">
          Sign up
        </div>
      </div>

      {/* Arrows from the form to the positions it creates */}
      <svg className="absolute left-[190px] top-[40px] h-[110px] w-[140px] text-neutral-400" viewBox="0 0 140 110" fill="none">
        <path d="M6 100 C 18 40, 62 12, 124 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M116 9 L126 16 L116 23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M30 104 C 44 66, 80 46, 124 46" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 5" />
        <path d="M116 40 L126 46 L116 52" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* Positions StopLoss watches */}
      <div className="absolute right-0 top-0 flex w-[280px] flex-col gap-4">
        {EXAMPLES.map((e) => (
          <div key={e.name} className="glass flex gap-3.5 rounded-2xl p-4" style={{ ...tilt(-18, 4, 0), marginLeft: e.shift }}>
            <ServiceLogo name={e.name} domain={e.domain} size="sm" />
            <div className="min-w-0">
              <StatusChip tone={e.tone}>{e.status}</StatusChip>
              <div className="mt-1.5 text-[15px] font-semibold text-ink">{e.name}</div>
              <div className="text-[13px] text-ink">$20/mo</div>
              <div className="mt-0.5 text-[12px] text-muted">{e.renews}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EnvelopeArt({ email }: { email: string | null }) {
  return (
    <div className="relative h-[112px] w-[176px]" style={tilt(-8, 22, -8)} aria-hidden="true">
      <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-[#f5f5f3] to-[#e6e6e3] shadow-float" />
      <div
        className="absolute inset-x-0 top-0 h-[66px] rounded-t-xl bg-gradient-to-b from-[#e9e9e6] to-[#f7f7f5]"
        style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
      />
      <div
        className="absolute -right-6 top-9 max-w-[180px] truncate rounded-lg bg-white px-3 py-2 font-mono text-[11px] font-medium text-ink shadow-soft ring-1 ring-line"
        style={{ transform: "rotate(-14deg)" }}
      >
        {email ?? "you@stoploss.email"}
      </div>
    </div>
  );
}

export function CardArt() {
  return (
    <div className="relative h-[120px] w-[200px]" aria-hidden="true">
      <div className="absolute left-8 top-0 h-[104px] w-[164px] rounded-2xl bg-white/70 shadow-soft ring-1 ring-line" style={{ transform: "rotate(-4deg)" }} />
      <div className="absolute left-5 top-2 h-[104px] w-[164px] rounded-2xl bg-white/80 shadow-soft ring-1 ring-line" style={{ transform: "rotate(-8deg)" }} />
      <div
        className="absolute left-0 top-5 flex h-[108px] w-[172px] flex-col justify-between rounded-2xl bg-gradient-to-br from-[#2b2b2b] via-[#151515] to-[#050505] p-4 shadow-float"
        style={{ transform: "rotate(-10deg)" }}
      >
        <span className="h-6 w-8 rounded-md bg-gradient-to-br from-[#efece4] to-[#bdb6a6]" />
        <span className="font-mono text-[13px] tracking-[0.2em] text-white">•••• 4242</span>
      </div>
    </div>
  );
}

export function TrackArt() {
  return (
    <div className="glass w-[200px] rounded-2xl p-4" style={tilt(-14, 10, -6)} aria-hidden="true">
      <div className="flex gap-2.5">
        <ServiceLogo name="ChatGPT" domain="chatgpt.com" size="sm" />
        <ServiceLogo name="Notion" domain="notion.so" size="sm" />
        <ServiceLogo name="Perplexity" domain="perplexity.ai" size="sm" />
      </div>
      <div className="mt-3 text-[13px] font-semibold text-ink">Renews in 3 days</div>
      <div className="text-[12px] text-muted">$20/month</div>
    </div>
  );
}

export function ToggleArt() {
  return (
    <div className="glass flex items-center gap-4 rounded-full py-3 pl-3 pr-6" style={{ transform: "perspective(1000px) rotateX(14deg) rotateZ(-10deg)" }} aria-hidden="true">
      <span className="flex h-9 w-16 items-center rounded-full bg-neutral-200 p-1">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink shadow-[0_4px_10px_-2px_rgb(17_17_17/0.5)]">
          <span className="h-2.5 w-2.5 rounded-full bg-white" />
        </span>
      </span>
      <span className="text-[16px] font-semibold text-ink">Cancel this?</span>
    </div>
  );
}
