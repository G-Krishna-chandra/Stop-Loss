import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, AlertTriangle, Bookmark, CheckCircle2, Circle, Info, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { PositionStatus } from "@/types";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx("eyebrow", className)}>{children}</p>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  badge,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow className="mb-3">{eyebrow}</Eyebrow> : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[36px] font-bold leading-[1.05] tracking-[-0.03em] text-ink md:text-[44px]">{title}</h1>
          {badge}
        </div>
        {subtitle ? <p className="mt-2.5 text-lg text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("rounded-2xl border border-line bg-white shadow-soft", className)}>{children}</section>;
}

export function CardTitle({ icon: Icon, children, aside }: { icon?: LucideIcon; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-3 text-lg font-semibold tracking-tight text-ink">
        {Icon ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft">
            <Icon className="h-[18px] w-[18px] text-ink" strokeWidth={1.75} aria-hidden="true" />
          </span>
        ) : null}
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function StatCard({ label, value, tone = "default", hint }: { label: string; value: ReactNode; tone?: "default" | "red" | "green"; hint?: string }) {
  return (
    <Card className="px-6 py-5">
      <div className="flex items-center gap-1.5 text-[14px] text-muted">
        {label}
        {hint ? (
          <span title={hint} className="text-neutral-400">
            <Info className="h-4 w-4" aria-label={hint} />
          </span>
        ) : null}
      </div>
      <div
        className={clsx(
          "mt-2 text-[34px] font-bold tracking-[-0.03em] tabular-nums",
          tone === "red" && "text-red-600",
          tone === "green" && "text-emerald-600",
          tone === "default" && "text-ink",
        )}
      >
        {value}
      </div>
    </Card>
  );
}

const STATUS: Record<PositionStatus, { label: string; cls: string; Icon: LucideIcon }> = {
  open: { label: "Watching", cls: "bg-sky-50 text-sky-800 ring-sky-100", Icon: Circle },
  stop_pending: { label: "Action needed", cls: "bg-red-50 text-red-700 ring-red-100", Icon: AlertCircle },
  approved: { label: "In progress", cls: "bg-sky-50 text-sky-800 ring-sky-100", Icon: LoaderCircle },
  cancelling: { label: "In progress", cls: "bg-sky-50 text-sky-800 ring-sky-100", Icon: LoaderCircle },
  closed: { label: "Closed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-100", Icon: CheckCircle2 },
  kept: { label: "Kept", cls: "bg-neutral-100 text-neutral-700 ring-neutral-200", Icon: Bookmark },
  failed: { label: "Needs review", cls: "bg-amber-50 text-amber-800 ring-amber-100", Icon: AlertTriangle },
};

export function StatusPill({ status, large = false }: { status: PositionStatus; large?: boolean }) {
  const s = STATUS[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset",
        large ? "px-3.5 py-1.5 text-[15px]" : "px-2.5 py-1 text-[13px]",
        s.cls,
      )}
    >
      <s.Icon className={large ? "h-4 w-4" : "h-3.5 w-3.5"} strokeWidth={2} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function Pill({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "green" | "amber" | "violet" | "slate" | "red" }) {
  const cls = {
    blue: "bg-sky-50 text-sky-800 ring-sky-100",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-800 ring-amber-100",
    violet: "bg-violet-50 text-violet-700 ring-violet-100",
    slate: "bg-neutral-100 text-neutral-700 ring-neutral-200",
    red: "bg-red-50 text-red-700 ring-red-100",
  }[tone];
  return (
    <span className={clsx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium ring-1 ring-inset", cls)}>
      {children}
    </span>
  );
}

export function DetailRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-6 py-3.5">
          <dt className="text-[15px] text-muted">{k}</dt>
          <dd className="text-right text-[15px] font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// A neutral note box (replaces the old blue info boxes).
export function Note({ icon: Icon = Info, title, children }: { icon?: LucideIcon; title?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3.5 rounded-xl border border-line bg-brand-soft/70 p-4">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0">
        {title ? <div className="font-semibold text-ink">{title}</div> : null}
        <div className={clsx("text-[15px] text-muted", title && "mt-1")}>{children}</div>
      </div>
    </div>
  );
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[15px] font-semibold transition-colors disabled:opacity-60";
const outline = `${base} border border-line bg-white text-ink shadow-[0_1px_2px_rgb(17_17_17/0.04)] hover:bg-neutral-50`;

export const buttonClass = {
  primary: `${base} bg-brand text-white shadow-[0_1px_2px_rgb(17_17_17/0.2)] hover:bg-brand-dark`,
  secondary: outline,
  outline,
  // Kept for older call sites; same neutral outline.
  outlineBlue: outline,
  danger: `${base} border border-red-200 bg-white text-red-600 hover:bg-red-50`,
};

// Text link style: ink with an underline on hover.
export const linkClass = "font-medium text-ink underline decoration-neutral-300 underline-offset-4 hover:decoration-ink";
