"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "./Icon";

type A11yPrefs = { highContrast: boolean; largeText: boolean; reducedMotion: boolean };

const KEY = "medikiosk_a11y";
const DEFAULTS: A11yPrefs = { highContrast: false, largeText: false, reducedMotion: false };

const OPTIONS: { key: keyof A11yPrefs; label: string; labelHi: string }[] = [
  { key: "highContrast", label: "High contrast", labelHi: "गहरा रंग" },
  { key: "largeText", label: "Larger text", labelHi: "बड़ा अक्षर" },
  { key: "reducedMotion", label: "Reduce motion", labelHi: "कम हलचल" },
];

/**
 * localStorage-backed external store.
 *
 * Reading prefs in a `useState` initializer made a returning visitor hydrate
 * against a different `aria-checked` than the server had rendered, because the
 * server has no localStorage. `useSyncExternalStore` fixes that properly:
 * `getServerSnapshot` hands both sides DEFAULTS, then the stored prefs arrive
 * without a setState-in-effect re-render.
 */
const listeners = new Set<() => void>();

function emitPrefsChange(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", emitPrefsChange);
}

function subscribePrefs(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

let cachedRaw: string | null = null;
let cachedPrefs: A11yPrefs = DEFAULTS;

function readPrefs(): A11yPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  let raw: string;
  try {
    raw = localStorage.getItem(KEY) ?? "";
  } catch {
    return DEFAULTS;
  }
  // getSnapshot must return a stable reference between calls or React loops.
  if (raw === cachedRaw) return cachedPrefs;
  cachedRaw = raw;
  try {
    cachedPrefs = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<A11yPrefs>) };
  } catch {
    cachedPrefs = DEFAULTS;
  }
  return cachedPrefs;
}

function getServerPrefs(): A11yPrefs {
  return DEFAULTS;
}

function writePrefs(next: A11yPrefs): void {
  cachedPrefs = next;
  cachedRaw = null; // force a re-read to pick up exactly what we stored
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  emitPrefsChange();
}

export default function A11yToggle() {
  const [open, setOpen] = useState(false);
  const prefs = useSyncExternalStore(subscribePrefs, readPrefs, getServerPrefs);

  // Reflect prefs onto <html> for the stylesheet to pick up. Writes to
  // localStorage are owned by the store (writePrefs) rather than this effect,
  // so mounting can never overwrite the visitor's saved choices with DEFAULTS.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("a11y-high-contrast", prefs.highContrast);
    html.classList.toggle("a11y-large-text", prefs.largeText);
    html.classList.toggle("a11y-reduced-motion", prefs.reducedMotion);
  }, [prefs]);

  const toggle = (k: keyof A11yPrefs) => writePrefs({ ...prefs, [k]: !prefs[k] });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div role="dialog" aria-modal="false" aria-label="Accessibility · सहायता" id="a11y-panel" className="mb-1 w-72 rounded-xl border-2 border-line-strong bg-surface p-3 shadow-lg">
          <p className="panel-title">
            <Icon name="accessible" size={15} className="text-ink-3" />
            Accessibility · सहायता
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {OPTIONS.map(({ key, label, labelHi }) => (
              <button
                key={key}
                onClick={() => toggle(key)}
                role="switch"
                aria-checked={prefs[key]}
                className="flex min-h-[56px] w-full items-center justify-between rounded-lg px-3 py-2 text-[15px] transition-colors hover:bg-sunken"
              >
                <span className={prefs[key] ? "font-semibold text-ink" : "text-ink-2"}>{label} <span lang="hi" className="text-ink-3">· {labelHi}</span></span>
                <span className={`chip ${prefs[key] ? "chip-info" : ""}`}>
                  {prefs[key] ? "On · चालू" : "Off · बंद"}
                </span>
              </button>
            ))}

            {/* Kiosk Fullscreen Lock */}
            <button
              type="button"
              onClick={() => {
                if (typeof document !== "undefined") {
                  if (document.fullscreenElement) {
                    document.exitFullscreen().catch(() => {});
                  } else {
                    document.documentElement.requestFullscreen().catch(() => {});
                  }
                }
              }}
              className="mt-1 flex min-h-[56px] w-full items-center justify-between rounded-lg border border-line bg-sunken px-3 py-2 text-[14px] font-medium text-ink hover:bg-canvas transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Icon name="grid" size={15} />
                Kiosk Fullscreen <span lang="hi" className="text-ink-3">· पूरी स्क्रीन</span>
              </span>
              <span className="chip chip-neutral text-[10px]">Toggle</span>
            </button>
            {/* Text size quick A- / A+ */}
            <div className="mt-1 flex gap-2">
              <button type="button" onClick={() => writePrefs({ ...prefs, largeText: false })} aria-label="Normal text size" className="btn btn-secondary min-h-[56px] flex-1 text-base">A-</button>
              <button type="button" onClick={() => writePrefs({ ...prefs, largeText: true })} aria-label="Large text size" className="btn btn-secondary min-h-[56px] flex-1 text-lg font-bold">A+</button>
            </div>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Accessibility and kiosk options · सहायता विकल्प"
        aria-expanded={open}
        aria-controls="a11y-panel"
        className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-line-strong bg-surface text-ink shadow-md transition-colors hover:border-[var(--border-focus)]"
      >
        <Icon name="accessible" size={24} />
      </button>
    </div>
  );
}
