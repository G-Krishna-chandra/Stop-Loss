import { Mic } from "lucide-react";
import Link from "next/link";
import { hasDatabase, listPendingApprovals } from "@/db";

async function pendingCount(): Promise<number> {
  if (!hasDatabase()) return 0;
  try {
    return (await listPendingApprovals()).length;
  } catch {
    return 0;
  }
}

export async function TopBar() {
  const pending = await pendingCount();
  return (
    <header className="flex h-[68px] shrink-0 items-center justify-end gap-3 border-b border-slate-200 bg-white px-6 md:px-10">
      <Link
        href="/voice"
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
      >
        <Mic className="h-4 w-4" aria-hidden="true" />
        Voice
        {pending > 0 ? (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{pending}</span>
        ) : null}
      </Link>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white" aria-label="Signed in as KC">
        KC
      </div>
    </header>
  );
}
