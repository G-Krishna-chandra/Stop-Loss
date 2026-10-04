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

// Voice and the account badge, sitting in the page's top-right corner instead of a separate bar.
export async function CornerControls() {
  const pending = await pendingCount();
  return (
    <div className="flex items-center justify-end gap-3 px-4 pt-3 md:absolute md:right-10 md:top-6 md:z-30 md:p-0 2xl:right-14">
      <VoiceButton pending={pending} />
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white" aria-label="Signed in as KC">
        KC
      </div>
    </div>
  );
}
