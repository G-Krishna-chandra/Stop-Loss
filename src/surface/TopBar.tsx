import { hasDatabase, listPendingApprovals } from "@/db";
import { VoiceButton } from "./voice/VoiceAssistant";

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
      <VoiceButton pending={pending} />
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white" aria-label="Signed in as KC">
        KC
      </div>
    </header>
  );
}
