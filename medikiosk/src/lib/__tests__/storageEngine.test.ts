import { describe, expect, it } from "vitest";
import { resolveStorageEngine, selectDefaultEngine } from "@/lib/storageEngine";

describe("storageEngine (Batch D, R1 — SQLite opt-in)", () => {
  it("defaults to JSON when no engine is requested", () => {
    expect(resolveStorageEngine(undefined, true)).toBe("json");
    expect(resolveStorageEngine("", true)).toBe("json");
  });

  it("uses SQLite only when explicitly requested AND available", () => {
    expect(resolveStorageEngine("sqlite", true)).toBe("sqlite");
  });

  it("degrades to JSON when SQLite requested but unavailable (skip-if-unavailable)", () => {
    // Runtime without node:sqlite (older Node / flag off): never crash, fall back.
    expect(resolveStorageEngine("sqlite", false)).toBe("json");
  });

  it("never picks SQLite for an unknown value", () => {
    expect(resolveStorageEngine("postgres", true)).toBe("json");
  });
});

describe("selectDefaultEngine (unset MEDIKIOSK_DB)", () => {
  it("takes SQLite on a fresh data dir when available", () => {
    expect(selectDefaultEngine(true, false)).toBe("sqlite");
  });

  it("keeps JSON when a store already exists, even with SQLite available", () => {
    // Auto-switching would orphan live data — migration stays explicit.
    expect(selectDefaultEngine(true, true)).toBe("json");
  });

  it("stays on JSON when SQLite is unavailable", () => {
    expect(selectDefaultEngine(false, false)).toBe("json");
    expect(selectDefaultEngine(false, true)).toBe("json");
  });
});