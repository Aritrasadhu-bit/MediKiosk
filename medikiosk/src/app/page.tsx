"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LANGUAGES } from "@/lib/data";
import { SESSION_STORAGE_KEY, useSession } from "@/lib/useSession";
import { t, welcomeSpeech } from "@/lib/i18n";
import type { HistoryMode } from "@/lib/types";
import { speak } from "@/lib/speech";
import { Icon } from "@/components/Icon";
import { KioskShell } from "@/components/AppShell";

const MODES: { id: HistoryMode; icon: "pill" | "leaf"; titleKey: string; descKey: string }[] = [
  { id: "allopathic", icon: "pill", titleKey: "allopathic", descKey: "allopathicDesc" },
  { id: "ayush", icon: "leaf", titleKey: "ayush", descKey: "ayushDesc" },
];

const isHistoryMode = (m: unknown): m is HistoryMode => m === "allopathic" || m === "ayush";

/** Read and validate a persisted session field without throwing. */
function readStoredSession(): { language?: { code?: unknown }; mode?: unknown; attendantMode?: unknown } {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as { language?: { code?: unknown }; mode?: unknown; attendantMode?: unknown };
  } catch {
    return {};
  }
}

function readStoredLangCode(): string | null {
  const code = readStoredSession().language?.code;
  return typeof code === "string" && LANGUAGES.some((l) => l.code === code) ? code : null;
}

function readStoredMode(): unknown {
  return readStoredSession().mode;
}

export default function WelcomePage() {
  const { session, update } = useSession();
  const router = useRouter();
  // Stored values are unvalidated JSON: fall back instead of rendering (or
  // saving onto the encounter) a language/mode the app does not know.
  // Read synchronously for the FIRST paint: a returning visitor sees their
  // language immediately instead of flashing through English + unselected
  // and snapping over (the reload glitch). Server/fresh visitors get the
  // same English defaults the server renders; the flagged elements below
  // carry suppressHydrationWarning for the returning-visitor difference.
  const [selectedLang, setSelectedLang] = useState<string | null>(() => {
    const stored = readStoredLangCode();
    if (stored) return stored;
    const code = session.language?.code;
    return code && LANGUAGES.some((l) => l.code === code) ? code : null;
  });
  const [mode, setMode] = useState<HistoryMode>(() => {
    const stored = readStoredMode();
    if (isHistoryMode(stored)) return stored;
    return isHistoryMode(session.mode) ? session.mode : "allopathic";
  });
  const [needLang, setNeedLang] = useState(false);
  // Language choosing is always the first screen (step 1); clinic + helper +
  // Start unlock only after a language is chosen (step 2). A returning
  // visitor's saved language comes pre-selected, but they still land on
  // step 1 and confirm it with Continue.
  const [step, setStep] = useState<1 | 2>(1);
  // Attendant-assisted mode for patients who cannot operate the kiosk alone
  // (elderly, low-literacy, low-vision): auto-plays audio guidance on every
  // screen and is recorded on the encounter so assistance is attributable.
  const [attendantMode, setAttendantMode] = useState(session.attendantMode ?? false);
  // useSession hydrates from localStorage: if the persisted language arrives
  // after first render (cross-tab write), pre-select it — but stay on step 1
  // so language choosing remains the first screen. Adjusted during render
  // (not in an effect) and never overwrites an explicit user pick.
  const [lastSeenLang, setLastSeenLang] = useState<string | null>(null);
  if (session.language?.code && session.language.code !== lastSeenLang && !selectedLang) {
    setLastSeenLang(session.language.code);
    // Adopt only known codes — a corrupt stored value must never become the
    // selection (startKiosk would crash on the lookup below).
    if (LANGUAGES.some((l) => l.code === session.language!.code)) {
      setSelectedLang(session.language.code);
    }
    if (isHistoryMode(session.mode)) setMode(session.mode);
    setAttendantMode(session.attendantMode ?? false);
  }

  const handleSelectLang = (code: string) => {
    setSelectedLang(code);
    setNeedLang(false);
    const lang = LANGUAGES.find((l) => l.code === code);
    // Persist at tap time (not only on Start) so the top-right language chip
    // — and the screen-reader document language — reflect the tapped language
    // immediately.
    if (lang) {
      update({ language: lang });
      // Helper OFF = silent kiosk: no greeting chatter on tap.
      if (attendantMode) speak(welcomeSpeech(lang.code), lang.voiceCode ?? "hi-IN");
    }
  };

  const goToClinic = () => {
    if (!selectedLang) {
      setNeedLang(true);
      if (attendantMode) speak("कृपया पहले अपनी भाषा चुनें. Please select a language first.", "hi-IN");
      return;
    }
    setNeedLang(false);
    setStep(2);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  const startKiosk = () => {
    if (!selectedLang) {
      setNeedLang(true);
      return;
    }
    // No non-null assertion: an unknown code (stale storage, tampered state)
    // is treated like no selection instead of crashing the kiosk.
    const lang = LANGUAGES.find((l) => l.code === selectedLang);
    if (!lang) {
      setNeedLang(true);
      return;
    }
    update({
      step: "identify",
      language: lang,
      mode,
      patient: null,
      conversation: [],
      history: null,
      documents: [],
      redFlags: [],
      consentGranted: false,
      consentPurposes: [],
      // A new kiosk loop must not reuse the previous encounter's ids —
      // summary derives token from encounterId, so stale ids overwrite the
      // prior record and print the wrong slip.
      encounterId: undefined,
      token: undefined,
      attendantMode,
    });
    router.push("/identify");
    // Defensive fallback: if the client router is wedged (stale app shell,
    // frozen tab, odd webview) force a real navigation so Start never silently
    // dead-ends. In the healthy case the router has already moved on, so this
    // timer never fires a reload.
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        if (window.location.pathname !== "/identify") {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional resilience fallback
          window.location.href = "/identify";
        }
      }, 1200);
    }
  };

  return (
    <KioskShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {step === 1 ? (
        <>
        {/* Step 1: language first — slim branding so choosing language is the focus */}
        <div className="panel mb-4 overflow-hidden">
          <div className="govt-tricolor" aria-hidden="true" />
          <div className="flex items-center gap-3 p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand" aria-hidden="true">
              <Icon name="hospital" size={26} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold uppercase tracking-wide text-ink-3">District Hospital · जिला अस्पताल · Free OPD · निःशुल्क</p>
              <h1 suppressHydrationWarning className="mt-0.5 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl" lang={selectedLang ?? "en"}>{t("greeting", selectedLang ?? "en")}</h1>
            </div>
          </div>
        </div>
        <div className="mb-6 text-center">
          <p className="section-label">Step 1 of 2</p>
          <h2 suppressHydrationWarning className="mt-1 flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
            {t("chooseLanguage", selectedLang)}
          </h2>
        </div>

        <section className="panel" aria-labelledby="language-heading">
          <div className="panel-header">
            <h2 id="language-heading" className="panel-title">
              <Icon name="globe" size={15} className="text-ink-3" />
              Language <span lang="hi" className="font-normal text-ink-3">— अपनी भाषा चुनें</span>
            </h2>
            <span className="text-[13px] font-medium text-ink-2">
              Selected ✓
            </span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              {LANGUAGES.map((l) => {
                const active = selectedLang === l.code;
                return (
                  <button
                    key={l.code}
                    type="button"
                    suppressHydrationWarning
                    onClick={() => handleSelectLang(l.code)}
                    aria-pressed={active}
                    className={`flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-3 py-2.5 transition-colors active:scale-[0.98] ${
                      active
                        ? "border-brand bg-brand font-semibold text-white shadow-sm ring-1 ring-brand"
                        : "border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-sunken"
                    }`}
                  >
                    <span suppressHydrationWarning className={`text-[17px] font-bold leading-tight ${active ? "text-white" : ""}`}>{l.native}</span>
                    <span suppressHydrationWarning className={`text-[12px] leading-tight ${active ? "text-white/80" : "text-ink-3"}`}>{l.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <div className="mt-6">
          {needLang && (
            <div role="alert" className="banner banner-critical mb-3 justify-center text-center text-[15px] font-semibold">
              <Icon name="alert" size={18} /> Please select a language first · कृपया पहले अपनी भाषा चुनें
            </div>
          )}
          <div className="kiosk-actionbar -mx-4 rounded-t-2xl sm:mx-0 sm:rounded-2xl sm:border-2 sm:border-line-strong">
            <button
              type="button"
              onClick={goToClinic}
              className="btn btn-primary btn-lg kiosk-btn-lg w-full"
            >
              <span suppressHydrationWarning>{t("continue", selectedLang)}</span>
              <Icon name="arrowRight" size={20} />
            </button>
            <p className="mt-1 text-center text-[13px] text-ink-2">Next: choose department</p>
          </div>
        </div>
        </>
        ) : (
        <>
        {/* Step 2: clinic + helper + Start */}
        <div className="panel mb-4 overflow-hidden">
          <div className="govt-tricolor" aria-hidden="true" />
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand" aria-hidden="true">
              <Icon name="hospital" size={30} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold uppercase tracking-wide text-ink-3">District Hospital · जिला अस्पताल · OPD 9 AM – 1 PM</p>
              <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-ink sm:text-4xl" lang={selectedLang ?? "en"}>{t("slipTagline", selectedLang)}</h1>
              <p className="mt-1 text-[15px] text-ink-2">Free OPD registration · No fee at any step</p>
            </div>
            <div className="flex shrink-0 flex-col gap-1 text-right">
              <span className="chip chip-success text-[13px]"><span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" /> Token 12 running</span>
              <span className="text-[13px] text-ink-2">Avg wait ~18 min</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line bg-sunken px-4 py-2.5">
            <span className="chip chip-success"><Icon name="checkCircle" size={13} /> Free OPD</span>
            <span className="chip chip-info"><Icon name="shield" size={13} /> Ayushman Bharat Accepted</span>
            <span className="chip chip-neutral"><Icon name="checkCircle" size={13} /> ABHA Accepted</span>
          </div>
        </div>
        <div className="mb-6 flex items-center justify-between">
          <p className="section-label">Step 2 of 2</p>
          <button type="button" onClick={() => { setStep(1); setNeedLang(false); if (typeof window !== "undefined") window.scrollTo({ top: 0 }); }} className="btn btn-ghost btn-sm min-h-[44px]">
            <Icon name="arrowLeft" size={14} /> {t("changeLanguage", selectedLang)}
          </button>
        </div>

        <section className="panel mt-4" aria-labelledby="clinic-heading">
          <div className="panel-header">
            <h2 id="clinic-heading" className="panel-title">
              <Icon name="building" size={15} className="text-ink-3" />
              {t("selectClinic", selectedLang)}
            </h2>
            <button type="button" onClick={() => { const l = LANGUAGES.find((x) => x.code === selectedLang); speak(t("selectClinic", selectedLang), l?.voiceCode ?? "hi-IN"); }} aria-label="Listen clinic help" className="icon-btn min-h-[44px] min-w-[44px] border border-line">
              <Icon name="volume" size={16} />
            </button>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            {MODES.map((m) => {
              const active = mode === m.id;
              const img = m.id === "allopathic" ? "💊" : "🌿";
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={active}
                  className={`flex min-h-[88px] items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-colors active:scale-[0.99] ${
                    active
                      ? "border-brand bg-brand text-white shadow-sm ring-1 ring-brand"
                      : "border-line bg-surface hover:border-line-strong hover:bg-sunken"
                  }`}
                >
                  <span className="text-2xl" aria-hidden="true">{img}</span>
                  <Icon
                    name={m.icon}
                    size={19}
                    className={active ? "mt-0.5 text-white" : "mt-0.5 text-ink-3"}
                  />
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${active ? "text-white" : "text-ink"}`}>
                      {t(m.titleKey, selectedLang)}
                    </span>
                    <span className={`mt-0.5 block text-[13px] leading-snug ${active ? "text-white/80" : "text-ink-3"}`}>
                      {t(m.descKey, selectedLang)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="mt-6">
          <div className="kiosk-actionbar -mx-4 rounded-t-2xl sm:mx-0 sm:rounded-2xl sm:border-2 sm:border-line-strong">
          <button
            type="button"
            onClick={startKiosk}
            className="btn btn-primary btn-lg kiosk-btn-lg w-full"
          >
            {t("start", selectedLang)}
            <Icon name="arrowRight" size={20} />
          </button>
          <p className="mt-1 text-center text-[13px] text-ink-2">Takes ~2 min · Next: Identity</p>
          </div>
          <button
            type="button"
            onClick={() => setAttendantMode((v) => !v)}
            aria-pressed={attendantMode}
            className={`mt-4 flex min-h-[72px] w-full cursor-pointer items-center gap-3 rounded-xl border-2 p-3 text-left ${attendantMode ? "border-warning bg-warning-subtle" : "border-line bg-surface"}`}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning" aria-hidden="true">
              <Icon name="bell" size={24} />
            </span>
            <span className="text-[15px] text-ink-2">
              <strong className="font-bold text-ink">{t("helperTitle", selectedLang)}</strong>
              <span className="block text-[14px]">{t("helperDesc", selectedLang)}</span>
              <span className={`chip mt-1 ${attendantMode ? "chip-warning" : "chip-neutral"}`}>{attendantMode ? t("helperOn", selectedLang) : t("helperOff", selectedLang)}</span>
            </span>
          </button>
          {needLang && (
            <div role="alert" className="banner banner-critical mt-3 justify-center text-center text-[15px] font-semibold">
              <Icon name="alert" size={18} /> Please select a language first · कृपया पहले अपनी भाषा चुनें
            </div>
          )}
          <div className="banner banner-info mt-4">
            <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
            <span className="text-[14px]">
              Nothing is saved until you review and confirm on the last screen. You can stop anytime.
              {" "}<span className="font-semibold">Free service.</span>
            </span>
          </div>
          <p className="mt-3 flex items-start justify-center gap-2 text-center text-[13px] leading-relaxed text-ink-2">
            <Icon name="shield" size={14} className="mt-px shrink-0" />
            <span>
              Screen auto-cleaned regularly · कृपया स्टाइलस इस्तेमाल करें / हाथ धोएं। ABDM · DPDP Act 2023 protected.
            </span>
          </p>
        </div>
        </>
        )}
      </div>
    </KioskShell>
  );
}
