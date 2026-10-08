import { describe, expect, it } from "vitest";
import { clearStaffCaches, STAFF_CLEARED_KEYS } from "@/lib/staffLogout";

/**
 * Staff sign-out must wipe locally cached PHI/PII.
 *
 * Server-side revocation alone left the full encounter store
 * (`medikiosk_histories`) plus the kiosk session and identify draft readable
 * to the next person at a shared terminal. These tests pin the wipe list.
 */

function fakeStorage(seed: Record<string, string>) {
  const backing = new Map(Object.entries(seed));
  return {
    backing,
    removeItem(key: string) {
      backing.delete(key);
    },
  };
}

describe("clearStaffCaches", () => {
  it("removes the session, the encounter cache and the identify draft", () => {
    const storage = fakeStorage({
      medikiosk_session: "{}",
      medikiosk_histories: "[]",
      medikiosk_identify_draft: "{}",
      medikiosk_outbox: "[]",
      unrelated: "keep",
    });
    const dispatched: string[] = [];
    clearStaffCaches(storage, (name) => dispatched.push(name));

    for (const key of STAFF_CLEARED_KEYS) {
      expect(storage.backing.has(key), `${key} must be wiped on sign-out`).toBe(false);
    }
  });

  it("never drops the offline outbox (unsynced submissions must survive)", () => {
    const storage = fakeStorage({ medikiosk_outbox: '[{"id":"ob-1"}]' });
    clearStaffCaches(storage, () => {});
    expect(storage.backing.get("medikiosk_outbox")).toBe('[{"id":"ob-1"}]');
  });

  it("notifies subscribers so mounted screens re-render empty", () => {
    const storage = fakeStorage({});
    const dispatched: string[] = [];
    clearStaffCaches(storage, (name) => dispatched.push(name));
    expect(dispatched).toContain("medikiosk-session-change");
    expect(dispatched).toContain("medikiosk-histories-change");
  });
});
