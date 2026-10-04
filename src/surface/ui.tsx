import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, AlertTriangle, Bookmark, CheckCircle2, Circle, Info, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { PositionStatus } from "@/types";

export function PageHeader({
  title,
  subtitle,
  actions,
  badge,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-slate-900 md:text-[40px]">{title}</h1>
          {badge}
        </div>
        {subtitle ? <p className="mt-1.5 text-lg text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("rounded-xl border border-slate-200 bg-white", className)}>{children}</section>;
}

export function CardTitle({ icon: Icon, children, aside }: { icon?: LucideIcon; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-3 text-xl font-semibold text-slate-900">
        {Icon ? <Icon className="h-6 w-6 text-slate-700" strokeWidth={1.75} aria-hidden="true" /> : null}
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function StatCard({ label, value, tone = "default", hint }: { label: string; value: ReactNode; tone?: "default" | "red" | "green"; hint?: string }) {
  return (
    <Card className="px-6 py-5">
      <div className="flex items-center gap-1.5 text-[15px] text-slate-600">
        {label}
        {hint ? (
          <span title={hint} className="text-slate-400">
            <Info className="h-4 w-4" aria-label={hint} />
          </span>
        ) : null}
      </div>
      <div
        className={clsx(
          "mt-2 text-[32px] font-bold tracking-tight tabular-nums",
          tone === "red" && "text-red-600",
          tone === "green" && "text-emerald-600",
          tone === "default" && "text-slate-900",
        )}
      >
        {value}
      </div>
    </Card>
  );
}

const STATUS: Record<PositionStatus, { label: string; cls: string; Icon: LucideIcon }> = {
  open: { label: "Watching", cls: "bg-blue-50 text-blue-700", Icon: Circle },
  stop_pending: { label: "Action needed", cls: "bg-red-50 text-red-700", Icon: AlertCircle },
  approved: { label: "In progress", cls: "bg-blue-50 text-blue-700", Icon: LoaderCircle },
  cancelling: { label: "In progress", cls: "bg-blue-50 text-blue-700", Icon: LoaderCircle },
  closed: { label: "Closed", cls: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2 },
  kept: { label: "Kept", cls: "bg-slate-100 text-slate-700", Icon: Bookmark },
  failed: { label: "Needs review", cls: "bg-amber-50 text-amber-800", Icon: AlertTriangle },
};

export function StatusPill({ status, large = false }: { status: PositionStatus; large?: boolean }) {
  const s = STATUS[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        large ? "px-4 py-1.5 text-base" : "px-3 py-1 text-sm",
        s.cls,
      )}
    >
      <s.Icon className={large ? "h-5 w-5" : "h-4 w-4"} strokeWidth={2} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function Pill({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "green" | "amber" | "violet" | "slate" | "red" }) {
  const cls = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    violet: "bg-violet-50 text-violet-700",
    slate: "bg-slate-100 text-slate-700",
    red: "bg-red-50 text-red-700",
  }[tone];
  return <span className={clsx("inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium", cls)}>{children}</span>;
}

export function DetailRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-slate-100">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-6 py-3.5">
          <dt className="text-[15px] text-slate-600">{k}</dt>
          <dd className="text-right text-[15px] font-medium text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-[15px] font-semibold text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-60",
  outlineBlue:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2 text-[15px] font-semibold text-brand transition-colors hover:bg-blue-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-5 py-2.5 text-[15px] font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60",
};
