"use client";

import { useEffect, useRef, useState } from "react";
import { speak } from "@/lib/speech";
import { qt, tokenCalledSpeech } from "@/lib/i18n";
import { LANGUAGES } from "@/lib/data";
import { subscribeCalls } from "@/lib/callChannel";
import { Icon } from "@/components/Icon";

/** localStorage key for the board's own display language (shared TV, no per-patient session). */
const BOARD_LANG_KEY = "medikiosk_board_lang";

/** Public waiting-room display: big queue + "now calling" for the TV/waiting area. */
type DisplayRow = {
  encounterId: string;
  token: string;
  department: string;
  enteredAt: string;
  age: number;
  sex: string;
  severity: "high" | "medium" | "normal";
  waitingMin: number;
  etaMin: number;
  nameInitial: string;
  status: string;
  lang: string;
  voiceCode: string;
};

type CurrentCall = { encounterId: string; token: string; at: string };

/** A called token still waiting this long gets one repeat announcement. */
const RECALL_AFTER_MS = 5 * 60_000;

const SEV_STYLE: Record<string, { bar: string; chip: string; label: string }> = {
  high: { bar: "bg-critical", chip: "chip-critical", label: "Urgent" },
  medium: { bar: "bg-warning", chip: "chip-warning", label: "Monitor" },
  normal: { bar: "bg-success", chip: "chip-success", label: "Routine" },
};

function playAnnouncementChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [
      { freq: 523.25, time: 0.0, dur: 0.28 }, // C5
      { freq: 659.25, time: 0.22, dur: 0.28 }, // E5
      { freq: 783.99, time: 0.44, dur: 0.55 }, // G5
    ];
    for (const n of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = n.freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + n.time);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + n.time + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + n.time + n.dur);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + n.time);
      o.stop(ctx.currentTime + n.time + n.dur + 0.05);
    }
    window.setTimeout(() => ctx.close(), 2000);
  } catch {
    /* audio context not permitted or unavailable */
  }
}

export default function DisplayPage() {
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [currentCall, setCurrentCall] = useState<CurrentCall | null>(null);
  const [currentRow, setCurrentRow] = useState<DisplayRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Board language, like the patient welcome screen: 10 kiosk languages,
  // persisted so the TV keeps its choice across refreshes. Defaults to
  // English; unknown stored codes fall back via qt().
  const [boardLang, setBoardLang] = useState("en");
  // Adopt the stored choice during render (not in an effect): the board is a
  // shared TV with no session to hydrate from, and this runs once.
  const [boardLangHydrated, setBoardLangHydrated] = useState(false);
  if (!boardLangHydrated && typeof window !== "undefined") {
    setBoardLangHydrated(true);
    try {
      const saved = window.localStorage.getItem(BOARD_LANG_KEY);
      if (saved && saved !== boardLang && LANGUAGES.some((l) => l.code === saved)) {
        setBoardLang(saved);
      }
    } catch {
      /* storage unavailable — stay on English */
    }
  }

  const pickBoardLang = (code: string) => {
    setBoardLang(code);
    try {
      window.localStorage.setItem(BOARD_LANG_KEY, code);
    } catch {
      /* best effort */
    }
  };

  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/queue", { cache: "no-store" });
        const json = await res.json();
        if (cancelled || !json.ok) return;
        if (typeof json.queue === "object") {
          const q = Array.isArray(json.queue) ? json.queue : Object.values(json.queue);
          setRows(q as DisplayRow[]);
        }
        if (json.currentCall) setCurrentCall(json.currentCall as CurrentCall);
        if (json.currentRow) setCurrentRow(json.currentRow as DisplayRow);
      } catch {
        /* display is read-only — stay on last known state */
      }
    };
    load();
    const timer = window.setInterval(load, 5_000);
    // Same-device instant refresh from the physician's BroadcastChannel.
    const unsub = subscribeCalls(() => load());
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsub();
    };
  }, []);

  // Announce a new call out loud + flash with airport/hospital chime chime.
  // The call-out speaks the CALLED patient's own kiosk language (from the
  // queue feed), never a fixed Hindi+English script.
  const announcedAt = useRef<string>("");
  useEffect(() => {
    if (currentCall && currentCall.at !== announcedAt.current) {
      announcedAt.current = currentCall.at;
      playAnnouncementChime();
      const lang = currentRow?.lang ?? "hi";
      const voice = currentRow?.voiceCode ?? "hi-IN";
      window.setTimeout(() => {
        speak(
          tokenCalledSpeech({ lang, token: currentCall.token }),
          voice
        );
      }, 700);
      if (navigator.vibrate) navigator.vibrate([400, 120, 400]);
    }
  }, [currentCall, currentRow]);

  // Missed-call recall: a called token still waiting 5+ minutes later gets
  // exactly one repeat chime + announcement (the patient stepped out for
  // water). Resolved calls are marked so they never recall.
  const recalledAt = useRef<string>("");
  const [recallFor, setRecallFor] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- time-driven external sync, ref-guarded to fire once per call */
  useEffect(() => {
    if (!currentCall) return;
    const key = `${currentCall.encounterId}|${currentCall.at}`;
    if (recalledAt.current === key) return;
    const row = rows.find((r) => r.encounterId === currentCall.encounterId);
    if (!row || (row.status !== "pending" && row.status !== "triage")) {
      recalledAt.current = key;
      return;
    }
    if (Date.now() - new Date(currentCall.at).getTime() >= RECALL_AFTER_MS) {
      recalledAt.current = key;
      setRecallFor(key);
      playAnnouncementChime();
      const lang = currentRow?.lang ?? row.lang ?? "hi";
      const voice = currentRow?.voiceCode ?? row.voiceCode ?? "hi-IN";
      window.setTimeout(() => {
        speak(tokenCalledSpeech({ lang, token: currentCall.token }), voice);
      }, 700);
    }
  }, [currentCall, rows, currentRow, now]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const showRecall =
    !!currentCall && recallFor === `${currentCall.encounterId}|${currentCall.at}`;

  const clock = new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const date = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  const [highContrast, setHighContrast] = useState(false);

  return (
    <div className={`min-h-screen px-6 py-6 ${highContrast ? "tv-contrast" : "bg-slate-950 text-white"}`}>
      <div className="govt-tricolor mb-4 rounded" aria-hidden="true" />
      <header className="flex items-center justify-between gap-6 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-900">
            <Icon name="hospital" size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{qt("boardTitle", boardLang)}</h1>
            <p className="text-sm text-slate-400">District Hospital · जिला अस्पताल · {date} · Free Service · निःशुल्क</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setHighContrast((v) => !v)} aria-pressed={highContrast} className="btn btn-secondary btn-sm min-h-[44px]">
            {highContrast ? "Standard view" : "High-contrast TV · तेज़ रंग"}
          </button>
        <div className="text-right">
          <div className="tabular text-4xl font-semibold">{clock}</div>
          <p className="text-xs text-slate-400">{qt("watchHint", boardLang)}</p>
        </div>
        </div>
      </header>

      {/* Board language dropdown — same 10 kiosk languages as the patient welcome screen */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="board-lang" className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
          <Icon name="translate" size={13} />
          Language · भाषा:
        </label>
        <select
          id="board-lang"
          value={boardLang}
          onChange={(e) => pickBoardLang(e.target.value)}
          className="min-h-[44px] cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white outline-none transition-colors hover:border-slate-500 focus:border-white"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} className="bg-slate-900 text-white">
              {l.native} — {l.name}
            </option>
          ))}
        </select>
      </div>

      {/* Now calling */}
      <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
        {currentCall ? (
          <div className="animate-fadeIn">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-emerald-400">{qt("nowCalling", boardLang)}</p>
            <p className={`tabular mt-3 font-bold leading-none break-all ${highContrast ? "tv-token" : "text-8xl sm:text-9xl"}`}>{currentCall.token}</p>
            {rows.find((r) => r.encounterId === currentCall.encounterId)?.nameInitial && (
              <p className="mt-4 text-2xl text-slate-300">
                {rows.find((r) => r.encounterId === currentCall.encounterId)?.nameInitial} &middot;{" "}
                {rows.find((r) => r.encounterId === currentCall.encounterId)?.department}
              </p>
            )}
            {showRecall && (
              <p role="status" className="mx-auto mt-4 flex w-fit items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-400/10 px-4 py-2 text-lg font-semibold text-amber-300">
                <Icon name="bell" size={18} />
                {qt("nowCalling", boardLang)} — {qt("proceedDoctor", boardLang)}
              </p>
            )}
            <p className="mt-5 text-lg text-slate-400">
              {qt("proceedDoctor", boardLang)}
            </p>
          </div>
        ) : (
          <div className="py-10">
            <p className="text-2xl text-slate-400">{qt("waitingNext", boardLang)}</p>
            <p className="mt-2 text-base text-slate-500">{qt("beSeated", boardLang)}</p>
          </div>
        )}
      </section>

      {/* Queue */}
      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{qt("waitingList", boardLang)} — Priority: Sr. Citizen / Divyang / Pregnant first</h2>
          <span className="tabular text-sm text-slate-500">
            {rows.length} {qt("patients", boardLang)}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-800 px-6 py-12 text-center text-slate-500">
            No one is waiting right now. New tokens appear here automatically.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r, i) => {
              const base = SEV_STYLE[r.severity] ?? SEV_STYLE.normal;
              const style = {
                ...base,
                label: r.severity === "high" ? qt("urgent", boardLang) : r.severity === "medium" ? qt("monitor", boardLang) : qt("routine", boardLang),
              };
              const wait = Math.max(0, Math.round((now - new Date(r.enteredAt).getTime()) / 60_000));
              return (
                <div
                  key={r.encounterId}
                  className={`flex items-center gap-3 rounded-lg border bg-slate-900 p-3.5 ${
                    currentCall?.encounterId === r.encounterId
                      ? "border-emerald-400"
                      : "border-slate-800"
                  }`}
                >
                  <span className={`w-1 self-stretch rounded-full ${style.bar}`} aria-hidden="true" />
                  <span className="tabular w-8 shrink-0 text-xl font-semibold text-slate-500">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="tabular text-xl font-semibold">{r.token}</p>
                    <p className="truncate text-sm text-slate-400">{r.department}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`chip ${style.chip}`}>{style.label}</span>
                    <span className="tabular text-sm text-slate-400">{wait} {qt("minUnit", boardLang)}</span>
                    <span className="tabular text-xs text-slate-500">ETA ~{r.etaMin} {qt("minUnit", boardLang)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <footer className="mt-8 border-t border-slate-800 pt-4 text-center text-sm text-slate-500">
        {qt("keepSlip", boardLang)} · Complaint? 104 · Valid today only
      </footer>
    </div>
  );
}