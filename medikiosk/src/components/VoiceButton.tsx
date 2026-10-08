"use client";

import { useEffect, useRef, useState } from "react";
import { createRecognizer, type SpeechStatus } from "@/lib/speech";
import { Icon } from "./Icon";

type Props = {
  lang: string;
  onTranscript: (text: string) => void;
  disabled?: boolean;
  /** Optional custom button label */
  label?: string;
  /** Whether to show push-to-talk hint and animated waveform */
  showWaveform?: boolean;
};

type RecognizerLike = { start: () => void; stop: () => void };

export default function VoiceButton({
  lang,
  onTranscript,
  disabled,
  label,
  showWaveform = true,
}: Props) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [isPtt, setIsPtt] = useState(false);
  const recRef = useRef<RecognizerLike | null>(null);
  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  // Set when a press-and-hold just ended: the browser will still fire a
  // synthetic click on release, which must NOT toggle listening back on.
  const pttJustEnded = useRef(false);

  // Stop listening if component unmounts
  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      recRef.current?.stop();
    };
  }, []);

  const startListening = () => {
    if (disabled || status === "listening") return;
    const rec = createRecognizer(lang, (text) => {
      setStatus("idle");
      setIsPtt(false);
      onTranscript(text.trim());
    });

    if (!rec) {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 1500);
      return;
    }

    rec.onerror = () => {
      setStatus("error");
      setIsPtt(false);
      setTimeout(() => setStatus("idle"), 1500);
    };

    rec.onend = () => {
      if (recRef.current === rec) {
        setStatus("idle");
        setIsPtt(false);
      }
    };

    recRef.current = rec;
    try {
      rec.start();
      setStatus("listening");
    } catch {
      setStatus("idle");
      setIsPtt(false);
    }
  };

  const stopListening = () => {
    if (status === "listening") {
      recRef.current?.stop();
      setStatus("idle");
      setIsPtt(false);
    }
  };

  const handleToggleClick = () => {
    if (disabled) return;
    // Release after a hold fires click too — swallow it so listening stays off.
    if (pttJustEnded.current) {
      pttJustEnded.current = false;
      return;
    }
    if (status === "listening") {
      stopListening();
    } else {
      startListening();
    }
  };

  // Push-To-Talk pointer handlers
  const handlePointerDown = () => {
    if (disabled) return;
    pressTimer.current = setTimeout(() => {
      setIsPtt(true);
      startListening();
    }, 250);
  };

  const handlePointerUp = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (isPtt) {
      stopListening();
      pttJustEnded.current = true;
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleToggleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        disabled={disabled}
        aria-label={
          status === "listening"
            ? "Stop voice input (or release to finish speaking)"
            : "Start voice input (tap or press & hold to speak)"
        }
        aria-pressed={status === "listening"}
        className={`relative flex h-20 w-20 items-center justify-center rounded-full shadow-lg transition-all transform active:scale-95 select-none ${
          status === "listening"
            ? "bg-red-600 text-white ring-4 ring-red-300 dark:ring-red-900 animate-pulse"
            : status === "error"
            ? "bg-critical text-white"
            : "border-2 border-brand/40 bg-canvas text-brand hover:border-brand hover:bg-brand-subtle hover:text-ink shadow-brand/10"
        } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <Icon name="mic" size={30} />
      </button>

      {status === "error" && (
        <p role="status" className="max-w-[12rem] text-center text-[11px] font-medium text-critical">
          Mic not available — please type instead · माइक उपलब्ध नहीं, कृपया लिखें
        </p>
      )}

      {/* Real-time Audio Waveform & Status Indicator */}
      {status === "listening" && showWaveform && (
        <div className="flex flex-col items-center gap-1.5 animate-fadeIn">
          <div className="flex items-center gap-1 h-5 px-3 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300 border border-red-200 text-[11px] font-semibold">
            {/* Animated Equalizer Waveform Bars */}
            <span className="w-1 h-3 bg-red-600 rounded-full animate-[bounce_0.6s_infinite_100ms]" />
            <span className="w-1 h-4 bg-red-600 rounded-full animate-[bounce_0.6s_infinite_200ms]" />
            <span className="w-1 h-5 bg-red-600 rounded-full animate-[bounce_0.6s_infinite_300ms]" />
            <span className="w-1 h-3 bg-red-600 rounded-full animate-[bounce_0.6s_infinite_150ms]" />
            <span className="w-1 h-4 bg-red-600 rounded-full animate-[bounce_0.6s_infinite_250ms]" />
            <span className="ml-1.5">{isPtt ? "Hold to speak... release to finish" : "Listening... Tap to stop"}</span>
          </div>
          <span className="text-[10px] text-ink-3">
            Listening — speak clearly into the mic
          </span>
        </div>
      )}

      {status === "idle" && (
        <span className="text-[11px] font-medium text-ink-3 text-center">
          {label ?? "Tap or Press & Hold to speak"}
        </span>
      )}
    </div>
  );
}