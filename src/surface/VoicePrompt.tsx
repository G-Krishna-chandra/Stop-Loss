"use client";

import clsx from "clsx";
import { Mic } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Logo } from "./Logo";
import { buttonClass } from "./ui";

// Minimal Web Speech API types; TypeScript's DOM lib does not ship them.
type RecognitionResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Maps what was said to one decision, or null when it is unclear. "Don't cancel" is a keep.
export function interpret(transcript: string): "approve" | "decline" | null {
  const t = transcript.toLowerCase();
  const no = /\b(no|nope|keep|don'?t|do not|stop|wait)\b/.test(t);
  const yes = /\b(yes|yeah|yep|sure|cancel|do it|go ahead)\b/.test(t);
  if (no && !/\bcancel it anyway\b/.test(t)) return "decline";
  if (yes) return "approve";
  return null;
}

const noop = () => () => {};
// Voice needs both speech recognition and speech synthesis. The server assumes yes; the client checks.
function useVoiceSupported(): boolean {
  return useSyncExternalStore(
    noop,
    () => Boolean(recognitionCtor()) && "speechSynthesis" in window,
    () => true,
  );
}

type Phase = "idle" | "speaking" | "listening" | "heard" | "sending" | "done" | "error";

export function VoicePrompt({ approvalId, prompt }: { approvalId: string; prompt: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const supported = useVoiceSupported();
  const recRef = useRef<Recognition | null>(null);

  useEffect(() => () => recRef.current?.stop(), []);

  async function decide(decision: "approve" | "decline") {
    setPhase("sending");
    const res = await fetch(`/api/approvals/${approvalId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
    if (!res.ok) {
      setPhase("error");
      setMessage(data.error ?? "That did not go through.");
      return;
    }
    setPhase("done");
    if (data.runId) router.push(`/runs/${data.runId}`);
    else router.refresh();
  }

  function listen() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      setHeard(transcript);
      const decision = interpret(transcript);
      if (decision) {
        setPhase("heard");
        void decide(decision);
      } else {
        setPhase("idle");
        setMessage(`I heard "${transcript}". Say "cancel it" or "keep it", or use the buttons.`);
      }
    };
    rec.onerror = (e) => {
      setPhase("idle");
      setMessage(e.error === "not-allowed" ? "Microphone access is blocked. Use the buttons." : "I didn't catch that. Try again.");
    };
    rec.onend = () => setPhase((p) => (p === "listening" ? "idle" : p));
    setPhase("listening");
    rec.start();
  }

  function start() {
    setMessage(null);
    setHeard("");
    const utterance = new SpeechSynthesisUtterance(prompt);
    utterance.onend = listen;
    setPhase("speaking");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  const busy = phase === "sending" || phase === "heard" || phase === "done";
  return (
    <div className="mx-auto w-full max-w-[730px] rounded-2xl border border-slate-200 bg-white p-8 shadow-sm md:p-12">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <Logo className="h-7 w-7" />
        </span>
        <span className="text-lg font-semibold text-slate-900">StopLoss</span>
        <span className="text-[15px] text-slate-500">Now</span>
      </div>
      <p className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-8 py-7 text-[28px] font-medium leading-snug text-slate-900">{prompt}</p>

      <button
        type="button"
        onClick={start}
        disabled={!supported || busy || phase === "speaking" || phase === "listening"}
        className="mt-8 flex w-full flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 px-6 py-10 disabled:cursor-default"
        aria-live="polite"
      >
        <span className="flex h-16 items-center gap-1.5" aria-hidden="true">
          {Array.from({ length: 21 }).map((_, i) => (
            <span
              key={i}
              className={clsx("w-1.5 rounded-full", phase === "listening" || phase === "speaking" ? "voice-bar bg-brand" : "bg-blue-200")}
              style={{
                height: `${16 + ((i * 37) % 48)}px`,
                animationDelay: `${(i % 7) * 0.12}s`,
                opacity: 1 - Math.abs(10 - i) / 14,
              }}
            />
          ))}
        </span>
        <span className="text-lg text-slate-600">
          {!supported
            ? "Voice isn't available in this browser. Use the buttons."
            : phase === "speaking"
              ? "Speaking…"
              : phase === "listening"
                ? "Listening…"
                : busy
                  ? heard
                    ? `Heard: "${heard}"`
                    : "Sending…"
                  : (
                    <span className="inline-flex items-center gap-2 font-medium text-brand">
                      <Mic className="h-5 w-5" aria-hidden="true" />
                      Tap to answer by voice
                    </span>
                  )}
        </span>
      </button>
      {message ? <p className="mt-4 text-center text-[15px] font-medium text-slate-700">{message}</p> : null}

      <div className="mt-7 grid grid-cols-2 gap-4">
        <button type="button" disabled={busy} onClick={() => decide("approve")} className={buttonClass.primary + " py-4 text-lg"}>
          Yes, cancel it
        </button>
        <button type="button" disabled={busy} onClick={() => decide("decline")} className={buttonClass.secondary + " py-4 text-lg"}>
          Keep it
        </button>
      </div>
      <div className="mt-8 flex items-center gap-4 border-t border-slate-200 pt-7 text-[17px] text-slate-600">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
          <Logo className="h-6 w-6" />
        </span>
        I&apos;ll only cancel after your approval.
      </div>
    </div>
  );
}
