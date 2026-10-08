"use client";

/**
 * Kiosk draft-resume (Batch A, R2).
 *
 * A patient can spend several minutes at the identify form (name, ABHA, vitals,
 * consent) — a power flick or accidental refresh shouldn't cost them all of it.
 * We persist a lightweight snapshot of the identify form to localStorage on
 * every change, and /identify offers a "Resume your entry" banner when one is
 * found, restoring the exact fields plus the saved timestamp.
 */

export type IdentifyDraft = {
  savedAt: string;
  name: string;
  age: string;
  sex: "Male" | "Female" | "Other";
  mobile: string;
  abhaId: string;
  department: string;
  consent: boolean;
  respondent: "self" | "guardian";
  guardianName: string;
  guardianRelation: string;
  vitals: Record<string, number | undefined>;
};

const KEY = "medikiosk_identify_draft";

export function saveIdentifyDraft(draft: Omit<IdentifyDraft, "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    /* storage full — best effort */
    return;
  }
  emitDraftChange();
}

export function loadIdentifyDraft(): IdentifyDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IdentifyDraft;
    if (!parsed || typeof parsed.savedAt !== "string") return null;
    // Corrupt shapes (e.g. vitals as string, sex out of union) crash the
    // resume form — reject anything that is not a plausible draft.
    if (
      typeof parsed.name !== "string" ||
      typeof parsed.mobile !== "string" ||
      typeof parsed.abhaId !== "string" ||
      (parsed.sex !== undefined &&
        parsed.sex !== "Male" &&
        parsed.sex !== "Female" &&
        parsed.sex !== "Other")
    ) {
      return null;
    }
    if (parsed.vitals !== undefined && (typeof parsed.vitals !== "object" || parsed.vitals === null)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearIdentifyDraft(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emitDraftChange();
}

/**
 * Subscribable store so React can read the draft with `useSyncExternalStore`.
 *
 * Reading localStorage in a `useState` initializer (the old approach) made the
 * server render without the "Resume your entry" banner while the client
 * rendered it with one. Using it in a `useEffect` fixes hydration but trips
 * `react-hooks/set-state-in-effect` and costs an extra render pass. The
 * external-store API is the intended tool: `getServerSnapshot` gives the server
 * a value React can hydrate against, and the real value arrives automatically.
 */
const listeners = new Set<() => void>();

function emitDraftChange(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  // Cross-tab writes arrive here. Same-tab writes call emitDraftChange() directly.
  // Key-filtered: unrelated localStorage traffic must not re-parse + re-render.
  // A missing event (synthetic dispatches, older browsers) is treated as a
  // change so cross-tab resume never goes stale.
  window.addEventListener("storage", (e?: StorageEvent | null) => {
    const key = (e as StorageEvent | null | undefined)?.key;
    if (key === undefined || key === null || key === KEY) emitDraftChange();
  });
}

export function subscribeIdentifyDraft(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

let cachedRaw: string | null = null;
let cachedDraft: IdentifyDraft | null = null;

export function getIdentifyDraftSnapshot(): IdentifyDraft | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  // getSnapshot must return the same reference when nothing changed, or React
  // re-renders forever.
  if (raw === cachedRaw) return cachedDraft;
  cachedRaw = raw;
  cachedDraft = null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as IdentifyDraft;
    if (parsed && typeof parsed.savedAt === "string") {
      // An autosave with nothing typed in isn't worth offering to resume.
      cachedDraft = parsed.name || parsed.abhaId || parsed.mobile ? parsed : null;
    }
  } catch {
    cachedDraft = null;
  }
  return cachedDraft;
}

/** The server has no localStorage, so it always sees "no draft". */
export function getServerIdentifyDraftSnapshot(): IdentifyDraft | null {
  return null;
}