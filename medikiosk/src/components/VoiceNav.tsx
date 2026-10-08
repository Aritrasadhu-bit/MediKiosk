"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRecognizer, speechSupported } from "@/lib/speech";
import { matchCommand, voiceCommandHint, type VoiceIntent } from "@/lib/commands";
import { Icon } from "./Icon";

/** Speech support is fixed for the page's lifetime, so it never emits. */
const noopSubscribe = () => () => {};

/** The server can't know about browser APIs, so it always renders no mic. */
const serverSpeechUnsupported = () => false;

/**
 * Maximum time the mic stays open per tap. Voice commands are single short
 * phrases (Next / Back / Help), so the session auto-stops well before a
 * patient can wonder whether it is still listening — and a stuck recognizer
 * can never hold the mic (and the patient's attention) indefinitely.
 */
export const VOICE_NAV_MAX_SECONDS = 15;

/**
 * Floating voice-command mic for kiosk screens.
 *
 * Tap to speak a command (Next / Back / Skip / Help…). Results are matched
 * locally (English + Hindi) and dispatched to the page via `onCommand`.
 *
 * Capture assurance: while listening the button pulses, a live panel shows
 * "Listening… speak now" with animated waveform bars, a real countdown, and
 * a depleting progress bar, so the patient can SEE the mic is capturing.
 * Tapping the mic (or the countdown reaching zero) stops the session.
 */
export default function VoiceNav({ lang = "hi-IN", onCommand }: { lang?: string; onCommand: (intent: VoiceIntent) => void }) {
  const [listening, setListening] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(VOICE_NAV_MAX_SECONDS);
  const [heard, setHeard] = useState<string | null>(null);
  // Support is a browser capability, not app state, so it never changes during
  // a session — subscribe is a no-op. Probing during render instead made the
  // server emit nothing while Chrome emitted a mic button (`if (!supported)
  // return null`), a hydration mismatch on every page that mounts VoiceNav.
  const supported = useSyncExternalStore(noopSubscribe, speechSupported, serverSpeechUnsupported);
  const recRef = useRef<ReturnType<typeof createRecognizer> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    deadlineRef.current = null;
  };

  const stopListening = () => {
    clearTimer();
    try {
      recRef.current?.stop();
    } catch {
      /* already ended */
    }
    setListening(false);
  };

  useEffect(() => () => {
    clearTimer();
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    if (listening) {
      stopListening();
      return;
    }
    const rec = createRecognizer(lang, (text) => {
      clearTimer();
      setHeard(text);
      setListening(false);
      const intent = matchCommand(text);
      if (intent) {
        onCommand(intent);
        setHeard(null);
      } else {
        window.setTimeout(() => setHeard(null), 2500);
      }
    });
    if (!rec) return;
    recRef.current = rec;
    rec.onerror = () => stopListening();
    rec.onend = () => {
      clearTimer();
      setListening(false);
    };
    try {
      rec.start();
      setListening(true);
      // Countdown assurance + hard cap: the mic visibly counts down and can
      // never stay open longer than VOICE_NAV_MAX_SECONDS per tap.
      setSecondsLeft(VOICE_NAV_MAX_SECONDS);
      deadlineRef.current = Date.now() + VOICE_NAV_MAX_SECONDS * 1000;
      tickRef.current = setInterval(() => {
        const left = Math.max(0, Math.ceil(((deadlineRef.current ?? Date.now()) - Date.now()) / 1000));
        setSecondsLeft(left);
        if (left <= 0) stopListening();
      }, 250);
    } catch {
      clearTimer();
      setListening(false);
    }
  };

  if (!supported) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {heard && !listening && (
        <div className="max-w-[16rem] rounded-lg bg-ink px-3 py-2 text-[12px] text-canvas shadow-md">
          Heard: “{heard}”
        </div>
      )}
      {listening && (
        <div
          role="status"
          aria-live="polite"
          aria-label={`Listening for a voice command, ${secondsLeft} seconds left`}
          className="w-52 rounded-xl border-2 border-brand bg-canvas p-3 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
            <p className="text-[13px] font-bold text-ink">Listening… बोलिए</p>
            <span className="tabular ml-auto text-[13px] font-bold text-brand" role="timer">
              0:{String(secondsLeft).padStart(2, "0")}
            </span>
          </div>
          <div className="mt-2 flex h-5 items-center gap-1" aria-hidden="true">
            <span className="w-1 animate-[bounce_0.6s_infinite_100ms] rounded-full bg-brand" style={{ height: "60%" }} />
            <span className="w-1 animate-[bounce_0.6s_infinite_200ms] rounded-full bg-brand" style={{ height: "100%" }} />
            <span className="w-1 animate-[bounce_0.6s_infinite_300ms] rounded-full bg-brand" style={{ height: "75%" }} />
            <span className="w-1 animate-[bounce_0.6s_infinite_150ms] rounded-full bg-brand" style={{ height: "45%" }} />
            <span className="w-1 animate-[bounce_0.6s_infinite_250ms] rounded-full bg-brand" style={{ height: "90%" }} />
            <span className="ml-1.5 text-[11px] font-medium text-ink-2">Speak your command…</span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken"
            role="progressbar"
            aria-valuenow={secondsLeft}
            aria-valuemin={0}
            aria-valuemax={VOICE_NAV_MAX_SECONDS}
            aria-label="Listening time remaining"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-200"
              style={{ width: `${(secondsLeft / VOICE_NAV_MAX_SECONDS) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">Tap the mic to stop · माइक दबाकर रोकें</p>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        aria-label={
          listening
            ? `Stop listening, ${secondsLeft} seconds left`
            : "Voice commands (Next, Back, Skip, Help)"
        }
        className={`flex h-14 w-14 items-center justify-center rounded-full shadow-md transition-colors ${
          listening
            ? "mic-recording animate-pulse bg-red-600 text-white ring-4 ring-red-300"
            : "border border-line-strong bg-canvas text-ink-2 hover:border-[var(--border-focus)] hover:text-ink"
        }`}
      >
        <Icon name="mic" size={22} />
      </button>
      <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] text-ink-3">
        {listening ? `Listening… 0:${String(secondsLeft).padStart(2, "0")}` : voiceCommandHint(lang.split("-")[0])}
      </span>
    </div>
  );
}
