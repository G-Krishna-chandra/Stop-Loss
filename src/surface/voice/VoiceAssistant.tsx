"use client";

// Always-on StopLoss voice assistant (ElevenLabs Agents). Mounted once in the root layout, so a conversation keeps
// going while the user moves between pages. The page keeps the agent informed with contextual updates about runs,
// approvals, and the current page, and exposes a few client tools so the agent can act when asked.
import {
  ConversationProvider,
  type MessagePayload,
  useConversationClientTool,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import clsx from "clsx";
import { Mic, MicOff, Minus, PhoneOff } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

type Line = { role: "you" | "stoploss"; text: string; id: number };

type VoiceUi = {
  lines: Line[];
  open: boolean;
  setOpen: (open: boolean) => void;
  start: () => Promise<void>;
  error: string | null;
};

const VoiceUiContext = createContext<VoiceUi | null>(null);

function useVoiceUi(): VoiceUi {
  const ui = useContext(VoiceUiContext);
  if (!ui) throw new Error("useVoiceUi must be used inside VoiceProvider");
  return ui;
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);
  return (
    <ConversationProvider
      onMessage={(m: MessagePayload) => {
        counter.current += 1;
        const id = counter.current;
        setLines((ls) => [...ls.slice(-40), { role: m.role === "user" ? "you" : "stoploss", text: m.message, id }]);
      }}
      onError={(message: string) => setError(typeof message === "string" ? message : "Voice hit an error.")}
    >
      <VoiceShell lines={lines} error={error} setError={setError}>
        {children}
      </VoiceShell>
    </ConversationProvider>
  );
}

function VoiceShell({
  children,
  lines,
  error,
  setError,
}: {
  children: ReactNode;
  lines: Line[];
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const { startSession } = useConversationControls();
  const [open, setOpen] = useState(false);

  async function start() {
    setError(null);
    setOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Microphone access is blocked. Allow it in the browser to talk to StopLoss.");
      return;
    }
    const res = await fetch("/api/voice/token", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !body.token) {
      setError(body.error ?? "Voice couldn't start.");
      return;
    }
    startSession({ conversationToken: body.token, connectionType: "webrtc" });
  }

  return (
    <VoiceUiContext.Provider value={{ lines, open, setOpen, start, error }}>
      {children}
      <VoiceTools />
      <VoiceContextSync />
      <VoicePanel />
    </VoiceUiContext.Provider>
  );
}

// --- Tools the agent can call. Names and parameters must match scripts/voice-agent.mjs. -----------------

async function post(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const PAGES: Record<string, string> = {
  home: "/",
  positions: "/positions",
  inbox: "/inbox",
  activity: "/activity",
  settings: "/settings",
};

function VoiceTools() {
  const router = useRouter();

  useConversationClientTool("get_status", async () => {
    const res = await fetch("/api/voice/state", { cache: "no-store" });
    return JSON.stringify(await res.json());
  });

  useConversationClientTool("open_page", (p: Record<string, unknown>) => {
    const href = PAGES[String(p.page ?? "").toLowerCase()];
    if (!href) return `There is no ${String(p.page)} page. Pages: ${Object.keys(PAGES).join(", ")}.`;
    router.push(href);
    return `Opened ${String(p.page)}.`;
  });

  useConversationClientTool("open_run", (p: Record<string, unknown>) => {
    router.push(`/runs/${encodeURIComponent(String(p.run_id))}`);
    return "Opened the run.";
  });

  useConversationClientTool("open_position", (p: Record<string, unknown>) => {
    router.push(`/positions/${encodeURIComponent(String(p.position_id))}`);
    return "Opened the position.";
  });

  // Only after the user clearly said yes or no to this specific approval. The agent's prompt requires it.
  useConversationClientTool("answer_approval", async (p: Record<string, unknown>) => {
    const decision = String(p.decision);
    if (decision !== "approve" && decision !== "decline") return "decision must be approve or decline.";
    const { ok, data } = await post(`/api/approvals/${encodeURIComponent(String(p.approval_id))}`, { decision });
    if (!ok) return `That didn't go through: ${String(data.error ?? "unknown error")}`;
    if (typeof data.runId === "string") router.push(`/runs/${data.runId}`);
    else router.refresh();
    return decision === "approve" ? "Approved. A live browser run started to cancel it." : "Declined. StopLoss will keep it.";
  });

  // Cancel a watched subscription now. Only after the user explicitly confirmed the service and price.
  useConversationClientTool("cancel_subscription", async (p: Record<string, unknown>) => {
    const { ok, data } = await post(`/api/positions/${encodeURIComponent(String(p.position_id))}/cancel`, { decision: "approve" });
    if (!ok) return `That didn't go through: ${String(data.error ?? "unknown error")}`;
    if (typeof data.runId === "string") router.push(`/runs/${data.runId}`);
    return "Cancel started in a live browser.";
  });

  useConversationClientTool("research_trial", async (p: Record<string, unknown>) => {
    const res = await fetch(`/api/voice/research?product=${encodeURIComponent(String(p.product))}`, { cache: "no-store" });
    return JSON.stringify(await res.json().catch(() => ({ error: "lookup failed" })));
  });

  useConversationClientTool("start_signup", async (p: Record<string, unknown>) => {
    const { ok, data } = await post("/api/signup", { url: String(p.website ?? p.product) });
    if (!ok) return `That didn't go through: ${String(data.error ?? "unknown error")}`;
    if (typeof data.runId === "string") router.push(`/runs/${data.runId}`);
    return "Sign-up started. StopLoss is checking for a free trial first.";
  });

  useConversationClientTool("continue_run", async (p: Record<string, unknown>) => {
    const { ok, data } = await post(`/api/runs/${encodeURIComponent(String(p.run_id))}/continue`);
    return ok ? "Continuing the run." : `That didn't go through: ${String(data.error ?? "unknown error")}`;
  });

  return null;
}

// --- Keep the agent informed while a conversation is on. ------------------------------------------------

type StateRun = { id: string; kind: string; service: string; status: string; step: string | null; note: string | null };
type StateApproval = { id: string; kind: string; service: string; question: string | null };
type VoiceState = { runs: StateRun[]; approvals: StateApproval[] };

function pageName(path: string): string {
  if (path === "/") return "Home";
  if (path.startsWith("/runs/")) return `live browser run (run id ${path.split("/")[2]})`;
  if (path.startsWith("/positions/")) return `position detail (position id ${path.split("/")[2]})`;
  return path.replace("/", "").split("/")[0] || "Home";
}

function VoiceContextSync() {
  const { status } = useConversationStatus();
  const controls = useConversationControls();
  const pathname = usePathname();
  const controlsRef = useRef(controls);
  const seen = useRef(new Map<string, string>());

  useEffect(() => {
    controlsRef.current = controls;
  });

  // Runs and approvals: quiet context for progress, a spoken heads-up when StopLoss needs the user.
  useEffect(() => {
    if (status !== "connected") {
      seen.current = new Map();
      return;
    }
    let stopped = false;
    const tick = async (first: boolean) => {
      const res = await fetch("/api/voice/state", { cache: "no-store" }).catch(() => null);
      if (!res?.ok || stopped) return;
      const state = (await res.json()) as VoiceState;
      const { sendContextualUpdate, sendUserMessage } = controlsRef.current;
      if (first) {
        for (const r of state.runs) seen.current.set(`run:${r.id}`, `${r.status}|${r.step}|${r.note}`);
        for (const a of state.approvals) seen.current.set(`approval:${a.id}`, "1");
        sendContextualUpdate(`Status update: StopLoss right now: ${JSON.stringify(state)}`);
        return;
      }
      for (const r of state.runs) {
        const key = `run:${r.id}`;
        const sig = `${r.status}|${r.step}|${r.note}`;
        const prev = seen.current.get(key);
        if (prev === sig) continue;
        seen.current.set(key, sig);
        const text = `The ${r.kind} run for ${r.service} (run id ${r.id}) is ${r.status}${r.step ? `. Current step: ${r.step}` : ""}${r.note ? `. Note: ${r.note}` : ""}.`;
        const finished = r.status === "succeeded" || r.status === "failed";
        if (r.status === "paused" || (finished && prev !== undefined)) sendUserMessage(`Status update: ${text} Tell me briefly.`);
        else sendContextualUpdate(`Status update: ${text}`);
      }
      for (const a of state.approvals) {
        const key = `approval:${a.id}`;
        if (seen.current.has(key)) continue;
        seen.current.set(key, "1");
        sendUserMessage(`Status update: an approval is waiting for ${a.service} (approval id ${a.id}, ${a.kind}): ${a.question ?? ""} Ask me.`);
      }
    };
    void tick(true);
    const t = setInterval(() => void tick(false), 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [status]);

  useEffect(() => {
    if (status === "connected") controlsRef.current.sendContextualUpdate(`Status update: the user is now on the ${pageName(pathname)} page.`);
  }, [pathname, status]);

  return null;
}

// --- UI -----------------------------------------------------------------------------------------------

function VoicePanel() {
  const { lines, open, setOpen, start, error } = useVoiceUi();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const { endSession } = useConversationControls();
  const listRef = useRef<HTMLDivElement>(null);
  const on = status === "connected" || status === "connecting";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines.length, open]);

  const state =
    status === "connecting" ? "Connecting…" : status === "connected" ? (isMuted ? "Muted" : isSpeaking ? "Speaking" : "Listening") : "Off";

  if (!open) {
    if (!on) return null;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-lg"
      >
        <span className={clsx("h-2.5 w-2.5 rounded-full", isSpeaking ? "animate-pulse bg-white" : "bg-emerald-400")} aria-hidden="true" />
        StopLoss voice · {state}
      </button>
    );
  }

  return (
    <section
      aria-label="StopLoss voice"
      className="fixed bottom-5 right-5 z-40 flex max-h-[70vh] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl"
    >
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={clsx("h-2.5 w-2.5 rounded-full", status === "connected" ? (isSpeaking ? "animate-pulse bg-black" : "bg-emerald-500") : "bg-neutral-300")}
            aria-hidden="true"
          />
          <span className="font-semibold text-black">StopLoss voice</span>
          <span className="text-sm text-neutral-500">{state}</span>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Minimize voice" className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100">
          <Minus className="h-4 w-4" />
        </button>
      </header>

      <div ref={listRef} className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-4 py-3" aria-live="polite">
        {lines.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {on ? "Say hi. Ask what StopLoss is doing, what renews next, or tell it to cancel something." : "Voice is off."}
          </p>
        ) : (
          lines
            .filter((l) => !l.text.startsWith("Status update:"))
            .slice(-12)
            .map((l) => (
              <p
                key={l.id}
                className={clsx(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug",
                  l.role === "you" ? "self-end bg-black text-white" : "self-start bg-neutral-100 text-black",
                )}
              >
                {l.text}
              </p>
            ))
        )}
        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
      </div>

      <footer className="flex items-center gap-2 border-t border-neutral-200 px-4 py-3">
        {on ? (
          <>
            <button
              type="button"
              onClick={() => setMuted(!isMuted)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-black hover:bg-neutral-50"
            >
              {isMuted ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => endSession()}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
            >
              <PhoneOff className="h-4 w-4" aria-hidden="true" />
              End
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
            Start talking
          </button>
        )}
      </footer>
    </section>
  );
}

// Top bar control: starts the assistant, or reopens the panel while a conversation is on.
export function VoiceButton({ pending }: { pending: number }) {
  const { start, setOpen } = useVoiceUi();
  const { status } = useConversationStatus();
  const on = status === "connected" || status === "connecting";
  return (
    <button
      type="button"
      onClick={() => (on ? setOpen(true) : void start())}
      className={clsx(
        "inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold",
        on ? "border-black bg-black text-white" : "border-neutral-300 text-black hover:bg-neutral-50",
      )}
    >
      <Mic className="h-4 w-4" aria-hidden="true" />
      {on ? "Voice on" : "Voice"}
      {pending > 0 ? <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{pending}</span> : null}
    </button>
  );
}
