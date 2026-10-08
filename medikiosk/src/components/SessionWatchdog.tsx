"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { t } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

const IDLE_WARN_MS = 90_000; // show warning after 90s idle
const IDLE_RESET_MS = 120_000; // wipe after 120s idle

export default function SessionWatchdog() {
  const { session, reset } = useSession();
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const idleSince = useRef<number | null>(null);

  // The done screen is included deliberately: once a patient has their token
  // they walk away from the kiosk, and the encounter payload is still sitting
  // in localStorage. The idle reset is the only thing that clears it.
  const active = Boolean(session.patient);
  // The timeout popup speaks the patient's chosen language, like every other
  // patient-facing surface. Falls back to English per key.
  const uiLang = session.language?.code ?? "en";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onActivity = () => {
      idleSince.current = null;
      setSecondsLeft(null);
    };
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("touchstart", onActivity, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
    };
  }, []);

  // Timer-driven PII wipe: the interval below syncs external idle time into
  // state, and clearing on inactive is part of that sync (not render logic).
  /* eslint-disable react-hooks/set-state-in-effect -- idle-timer external sync */
  useEffect(() => {
    if (!active) {
      idleSince.current = null;
      setSecondsLeft(null);
      return;
    }
    const iv = setInterval(() => {
      // No document.hidden early-return: a backgrounded/minimized kiosk tab
      // must keep counting from timestamps, or PII never wipes.
      if (idleSince.current === null) {
        idleSince.current = Date.now();
      }
      const idle = Date.now() - (idleSince.current ?? Date.now());
      if (idle >= IDLE_WARN_MS && idle < IDLE_RESET_MS) {
        setSecondsLeft(Math.ceil((IDLE_RESET_MS - idle) / 1000));
      } else if (idle >= IDLE_RESET_MS) {
        idleSince.current = null;
        setSecondsLeft(null);
        reset();
        router.push("/");
      }
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (secondsLeft === null) return null;

  const dismiss = () => {
    idleSince.current = null;
    setSecondsLeft(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(16_24_40_/_0.55)] p-4">
      <div role="alertdialog" aria-labelledby="idle-title" aria-describedby="idle-desc" className="panel w-full max-w-sm p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning-subtle text-warning">
          <Icon name="clock" size={24} />
        </span>
        <h2 id="idle-title" className="mt-3 text-lg font-bold text-ink">
          {t("idleTitle", uiLang)}
        </h2>
        <p id="idle-desc" className="mt-1.5 text-[15px] text-ink-2">
          {t("idleTouch", uiLang)} — {t("idleClearing", uiLang)}{" "}
          <span className="tabular text-xl font-bold text-ink" role="timer" aria-live="assertive">0:{String(secondsLeft).padStart(2, "0")}</span> {t("idlePrivacy", uiLang)}
        </p>
        <button
          onClick={dismiss}
          autoFocus
          className="btn btn-primary mt-4 min-h-[56px] w-full text-[16px]"
        >
          {t("idleContinue", uiLang)}
        </button>
        <button
          onClick={() => {
            dismiss();
            reset();
            router.push("/");
          }}
          className="btn btn-secondary mt-2 min-h-[56px] w-full text-[16px]"
        >
          {t("idleFinish", uiLang)}
        </button>
      </div>
    </div>
  );
}