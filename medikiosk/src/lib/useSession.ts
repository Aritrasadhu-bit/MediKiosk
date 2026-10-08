"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Patient, Language, HistoryMode, ClinicalHistory, MedicalDocument, RedFlag, ConsentScope } from "./types";
import { safeSetItem } from "./storage";

export type Session = {
  step: "welcome" | "identify" | "history" | "scan" | "summary" | "done";
  language: Language | null;
  mode: HistoryMode;
  patient: Patient | null;
  conversation: { question: string; answer: string }[];
  history: ClinicalHistory | null;
  documents: MedicalDocument[];
  redFlags: RedFlag[];
  consentGranted: boolean;
  /** Per-purpose consent the patient ticked at /identify. */
  consentPurposes: ConsentScope[];
  consentAt?: string;
  /** Set when the kiosk encounter is submitted (summary → done). */
  encounterId?: string;
  /** Queue token issued at submission. */
  token?: string;
  /**
   * Attendant-assisted mode: a helper operates the kiosk for a patient who
   * cannot do it alone. Drives auto-played audio guidance on every screen and
   * is recorded on the encounter audit trail so assistance is attributable.
   */
  attendantMode?: boolean;
};

/** localStorage key for the kiosk session (exported for first-paint readers). */
export const SESSION_STORAGE_KEY = "medikiosk_session";
const KEY = SESSION_STORAGE_KEY;
const CHANGE_EVENT = "medikiosk-session-change";

const DEFAULT_SESSION: Session = {
  step: "welcome",
  language: null,
  mode: "allopathic",
  patient: null,
  conversation: [],
  history: null,
  documents: [],
  redFlags: [],
  consentGranted: false,
  consentPurposes: [],
};

let cachedRaw: string | null = null;
let cachedSession: Session = DEFAULT_SESSION;

function readSession(): Session {
  if (typeof window === "undefined") return DEFAULT_SESSION;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === cachedRaw) {
      return cachedSession;
    }
    cachedRaw = raw;
    if (raw) {
      cachedSession = { ...DEFAULT_SESSION, ...(JSON.parse(raw) as Partial<Session>) };
    } else {
      cachedSession = DEFAULT_SESSION;
    }
    return cachedSession;
  } catch {
    return DEFAULT_SESSION;
  }
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, callback);
  // Key-filtered: any localStorage write (outbox pings, drafts) used to
  // re-parse the session and re-render every subscriber. A missing event
  // object is treated as a change (synthetic dispatches).
  const onStorage = (e?: StorageEvent | null) => {
    const key = (e as StorageEvent | null | undefined)?.key;
    if (key === undefined || key === null || key === KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

const getServerSnapshot = () => DEFAULT_SESSION;

export function useSession() {
  const session = useSyncExternalStore(subscribe, readSession, getServerSnapshot);

  const update = useCallback((patch: Partial<Session>) => {
    // Blob preview URLs are invalid after a reload and bloat the store —
    // strip them before persisting (the live object keeps its previews).
    const cleanDocs = patch.documents?.map((d) =>
      d.previewUrl?.startsWith("blob:") ? { ...d, previewUrl: undefined } : d
    );
    const next = { ...readSession(), ...patch, ...(cleanDocs ? { documents: cleanDocs } : null) };
    // Quota-safe: warns loudly instead of pretending a dropped write persisted.
    safeSetItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const reset = useCallback(() => {
    try {
      const curr = readSession();
      curr.documents?.forEach((d) => {
        if (d.previewUrl?.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(d.previewUrl);
          } catch {
            /* ignore */
          }
        }
      });
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      window.localStorage.removeItem(KEY);
      // A kiosk loop must not resurrect the prior patient: clear in-progress
      // drafts too (history answers + identify form). Otherwise /done →
      // startNew → next patient restores the previous answers.
      window.localStorage.removeItem("medikiosk_history_draft");
      window.localStorage.removeItem("medikiosk_identify_draft");
    } catch {
      // ignore
    }
    cachedRaw = null;
    cachedSession = DEFAULT_SESSION;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { session, update, reset };
}