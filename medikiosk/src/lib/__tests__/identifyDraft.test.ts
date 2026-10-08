import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentifyDraft } from "@/lib/identifyDraft";

/**
 * The identify draft is now read through `useSyncExternalStore` so the server
 * and client agree on the first render (a `useState` initializer read
 * localStorage directly, which hydrated the "Resume your entry" banner against
 * different server HTML).
 *
 * The snapshot is memoised on the raw localStorage string. That cache is the
 * part most likely to break silently: a stale cache means the banner never
 * appears, or never goes away after Apply/Discard.
 *
 * This suite runs under `environment: "node"` (no jsdom in the project), so
 * `localStorage` and `window.addEventListener` are stubbed by hand. The store
 * touches nothing else, which is also what keeps it testable.
 */

const KEY = "medikiosk_identify_draft";
type Fields = Omit<IdentifyDraft, "savedAt">;

function fields(overrides: Partial<Fields> = {}): Fields {
  return {
    name: "Asha Verma",
    age: "34",
    sex: "Female",
    mobile: "9876543210",
    abhaId: "",
    department: "",
    consent: true,
    respondent: "self",
    guardianName: "",
    guardianRelation: "",
    vitals: {},
    ...overrides,
  };
}

let backing: Map<string, string>;
let windowStub: { dispatch: (type: string) => void };

function installBrowserGlobals() {
  backing = new Map();
  const listeners = new Map<string, Set<() => void>>();
  const localStorageStub = {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
  windowStub = {
    dispatch: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  };
  (globalThis as Record<string, unknown>).localStorage = localStorageStub;
  (globalThis as Record<string, unknown>).window = {
    localStorage: localStorageStub,
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    dispatch: windowStub.dispatch,
  };
}

function removeBrowserGlobals() {
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).window;
}

describe("identifyDraft external store", () => {
  beforeEach(() => {
    vi.resetModules();
    installBrowserGlobals();
  });

  afterEach(() => {
    removeBrowserGlobals();
  });

  it("returns null from the server snapshot", async () => {
    const store = await import("@/lib/identifyDraft");
    expect(store.getServerIdentifyDraftSnapshot()).toBeNull();
  });

  it("returns null when nothing is stored", async () => {
    const store = await import("@/lib/identifyDraft");
    expect(store.getIdentifyDraftSnapshot()).toBeNull();
  });

  it("reads a stored draft", async () => {
    const store = await import("@/lib/identifyDraft");
    backing.set(KEY, JSON.stringify({ ...fields(), savedAt: "2026-01-01T10:00:00.000Z" }));
    expect(store.getIdentifyDraftSnapshot()?.name).toBe("Asha Verma");
  });

  it("treats an autosave with nothing typed in as no draft", async () => {
    const store = await import("@/lib/identifyDraft");
    backing.set(
      KEY,
      JSON.stringify({
        ...fields({ name: "", abhaId: "", mobile: "" }),
        savedAt: "2026-01-01T10:00:00.000Z",
      })
    );
    expect(store.getIdentifyDraftSnapshot()).toBeNull();
  });

  it("keeps a draft that only has an identifier", async () => {
    const store = await import("@/lib/identifyDraft");
    backing.set(
      KEY,
      JSON.stringify({
        ...fields({ name: "", mobile: "", abhaId: "234567890124" }),
        savedAt: "2026-01-01T10:00:00.000Z",
      })
    );
    expect(store.getIdentifyDraftSnapshot()?.abhaId).toBe("234567890124");
  });

  it("returns a stable reference when nothing changed", async () => {
    const store = await import("@/lib/identifyDraft");
    backing.set(KEY, JSON.stringify({ ...fields(), savedAt: "2026-01-01T10:00:00.000Z" }));
    const first = store.getIdentifyDraftSnapshot();
    const second = store.getIdentifyDraftSnapshot();
    // useSyncExternalStore re-renders forever if getSnapshot is not
    // referentially stable between calls.
    expect(first).toBe(second);
  });

  it("picks up a draft written by saveIdentifyDraft after an empty read", async () => {
    const store = await import("@/lib/identifyDraft");
    expect(store.getIdentifyDraftSnapshot()).toBeNull();
    store.saveIdentifyDraft(fields());
    expect(store.getIdentifyDraftSnapshot()?.name).toBe("Asha Verma");
  });

  it("reflects a cleared draft instead of serving the cached one", async () => {
    const store = await import("@/lib/identifyDraft");
    backing.set(KEY, JSON.stringify({ ...fields(), savedAt: "2026-01-01T10:00:00.000Z" }));
    expect(store.getIdentifyDraftSnapshot()).not.toBeNull();

    store.clearIdentifyDraft();

    // The bug this guards: a stale cachedDraft kept the banner alive forever
    // after Apply/Discard.
    expect(backing.has(KEY)).toBe(false);
    expect(store.getIdentifyDraftSnapshot()).toBeNull();
  });

  it("picks up a draft overwritten in place", async () => {
    const store = await import("@/lib/identifyDraft");
    backing.set(KEY, JSON.stringify({ ...fields(), savedAt: "2026-01-01T10:00:00.000Z" }));
    expect(store.getIdentifyDraftSnapshot()?.name).toBe("Asha Verma");

    backing.set(KEY, JSON.stringify({ ...fields({ name: "Rekha Singh" }), savedAt: "2026-01-01T11:00:00.000Z" }));
    expect(store.getIdentifyDraftSnapshot()?.name).toBe("Rekha Singh");
  });

  it("ignores corrupt JSON instead of throwing during render", async () => {
    const store = await import("@/lib/identifyDraft");
    backing.set(KEY, "{not json");
    expect(store.getIdentifyDraftSnapshot()).toBeNull();
  });

  it("ignores a payload missing savedAt", async () => {
    const store = await import("@/lib/identifyDraft");
    backing.set(KEY, JSON.stringify({ name: "No Timestamp" }));
    expect(store.getIdentifyDraftSnapshot()).toBeNull();
  });

  it("notifies subscribers when a draft is saved or cleared", async () => {
    const store = await import("@/lib/identifyDraft");
    let calls = 0;
    const unsubscribe = store.subscribeIdentifyDraft(() => {
      calls += 1;
    });

    store.saveIdentifyDraft(fields());
    expect(calls).toBe(1);

    store.clearIdentifyDraft();
    expect(calls).toBe(2);

    unsubscribe();
    store.saveIdentifyDraft(fields());
    expect(calls).toBe(2);
  });

  it("reacts to a cross-tab storage event", async () => {
    const store = await import("@/lib/identifyDraft");
    const snapshot = store.getIdentifyDraftSnapshot();
    expect(snapshot).toBeNull();

    // Another tab writes; the browser fires `storage`, which the store listens
    // for so both tabs agree on whether to offer a resume.
    backing.set(KEY, JSON.stringify({ ...fields(), savedAt: "2026-01-01T10:00:00.000Z" }));
    windowStub.dispatch("storage");

    expect(store.getIdentifyDraftSnapshot()?.name).toBe("Asha Verma");
  });
});
