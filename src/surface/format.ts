// Display formatting for the web UI. Times show in Pacific by default (DISPLAY_TIME_ZONE overrides).
const TZ = process.env.DISPLAY_TIME_ZONE ?? process.env.NEXT_PUBLIC_DISPLAY_TIME_ZONE ?? "America/Los_Angeles";

export function money(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null) return "Unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function perPeriod(period: string | null | undefined): string {
  if (!period) return "month";
  const p = period.toLowerCase();
  if (p.startsWith("year") || p.startsWith("annual")) return "year";
  if (p.startsWith("week")) return "week";
  return "month";
}

export function price(cents: number | null | undefined, currency = "USD", period?: string | null): string {
  if (cents == null) return "Unknown";
  return `${money(cents, currency)}/${perPeriod(period)}`;
}

export function day(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso),
  );
}

export function time(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function dayTime(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  return `${day(iso)}, ${time(iso)}`;
}

// "10:24 AM" today, "Yesterday", or "Oct 28" for older mail, like the Inbox mockup.
export function inboxStamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const key = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(x);
  if (key(d) === key(now)) return time(iso);
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (key(d) === key(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d);
}

export function relativeDays(iso: string | null | undefined): string {
  if (!iso) return "";
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
