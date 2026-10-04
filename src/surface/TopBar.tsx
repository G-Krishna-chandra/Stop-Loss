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
    <header className="flex h-[68px] shrink-0 items-center justify-end gap-3 border-b border-line bg-white/80 px-6 backdrop-blur md:px-10">
      <VoiceButton pending={pending} />
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white" aria-label="Signed in as KC">
        KC
      </div>
    </header>
  );
}
