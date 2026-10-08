"use client";

/**
 * Complete staff sign-out for shared terminals.
 *
 * Server revocation alone is not enough: every staff screen caches full
 * encounter PHI in localStorage (`medikiosk_histories`), and the kiosk
 * session + identify draft hold pre-submission PII. Previously each page
 * called /api/auth/logout and redirected, leaving all of that readable to
 * the next person at the terminal (open another tab, or read localStorage).
 *
 * The offline outbox (`medikiosk_outbox`) is deliberately NOT cleared: it
 * holds unsynced patient submissions, and deleting it would lose data. It is
 * a sync queue, not a cache.
 */

export const STAFF_CLEARED_KEYS = [
  "medikiosk_session",
  "medikiosk_histories",
  "medikiosk_identify_draft",
] as const;

const STAFF_CLEARED_EVENTS = ["medikiosk-session-change", "medikiosk-histories-change"];

/** Remove cached PHI/PII and notify subscribers. Pure over injected I/O for tests. */
export function clearStaffCaches(
  storage: Pick<Storage, "removeItem">,
  dispatch: (eventName: string) => void
): void {
  for (const key of STAFF_CLEARED_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      /* best effort */
    }
  }
  for (const event of STAFF_CLEARED_EVENTS) {
    try {
      dispatch(event);
    } catch {
      /* best effort */
    }
  }
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  } catch {
    /* best effort */
  }
}

/** Revoke the server session, wipe local caches, then leave the staff area. */
export async function staffLogout(pushLogin: () => void): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* offline — local wipe below still runs */
  }
  if (typeof window !== "undefined") {
    clearStaffCaches(window.localStorage, (name) => window.dispatchEvent(new Event(name)));
  }
  pushLogin();
}
