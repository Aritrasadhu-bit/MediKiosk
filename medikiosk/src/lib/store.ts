import type { AuditAction, StoredHistory } from "./types";
import { buildDemoPatients } from "./demoData";
import { enqueueOutbox, flushOutbox } from "./outbox";
import { safeSetItem } from "./storage";

const KEY = "medikiosk_histories";
const CHANNEL = "medikiosk-histories";

let channel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  channel = new BroadcastChannel(CHANNEL);
}

export function notifyHistoriesChanged(): void {
  window.dispatchEvent(new Event("medikiosk-histories-change"));
  channel?.postMessage({ type: "histories-updated" });
}

export function subscribeHistories(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const local = () => {
    callback();
  };
  window.addEventListener("medikiosk-histories-change", local);
  window.addEventListener("storage", local);
  channel?.addEventListener("message", local);
  return () => {
    window.removeEventListener("medikiosk-histories-change", local);
    window.removeEventListener("storage", local);
    channel?.removeEventListener("message", local);
  };
}

let cachedHistoriesRaw: string | null = null;
let cachedHistories: StoredHistory[] = [];

export function loadStoredHistories(): StoredHistory[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === cachedHistoriesRaw) {
      return cachedHistories;
    }
    cachedHistoriesRaw = raw;
    if (!raw) {
      cachedHistories = [];
      return cachedHistories;
    }
    const parsed = JSON.parse(raw);
    cachedHistories = Array.isArray(parsed) ? (parsed as StoredHistory[]) : [];
    return cachedHistories;
  } catch {
    cachedHistories = [];
    return cachedHistories;
  }
}

/**
 * Server sync via the offline outbox: the write is queued first (survives
 * network drops), then flushed. The server is the cross-device source of truth.
 */
function syncToServer(record: StoredHistory): void {
  if (typeof window === "undefined") return;
  enqueueOutbox("/api/encounters", "POST", record);
  void flushOutbox();
}

function patchOnServer(encounterId: string, patch: Partial<StoredHistory>): void {
  if (typeof window === "undefined") return;
  enqueueOutbox(`/api/encounters/${encodeURIComponent(encounterId)}`, "PATCH", patch);
  void flushOutbox();
}

export function generateEncounterId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `enc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Save a new or updated encounter. Keyed by encounterId (NOT patient name),
 * so patients with identical names no longer overwrite each other.
 *
 * localStorage can throw when the quota is exhausted (months of kiosk
 * records). The server write must still go out — otherwise a full disk
 * silently eats the submission — so persistence is best-effort and the
 * outbox sync always runs.
 */
export function saveHistory(history: StoredHistory): void {
  if (typeof window === "undefined") return;
  const record: StoredHistory = { ...history, updatedAt: new Date().toISOString() };
  try {
    const current = loadStoredHistories().filter((h) => h.encounterId !== record.encounterId);
    current.push(record);
    // Quota-safe: warns loudly instead of silently dropping the record.
    safeSetItem(KEY, JSON.stringify(current));
    notifyHistoriesChanged();
  } catch {
    // Storage full or unavailable — the outbox sync below is the fallback.
  }
  syncToServer(record);
}

export function updateStoredHistory(encounterId: string, patch: Partial<StoredHistory>): void {
  if (typeof window === "undefined") return;
  const updatedAt = new Date().toISOString();
  try {
    const current = loadStoredHistories();
    const updated = current.map((h) =>
      h.encounterId === encounterId ? { ...h, ...patch, updatedAt } : h
    );
    safeSetItem(KEY, JSON.stringify(updated));
    notifyHistoriesChanged();
  } catch {
    // Storage full — the server patch below still goes out.
  }
  patchOnServer(encounterId, { ...patch, updatedAt });
}

export function recordAudit(encounterId: string, action: AuditAction, detail?: string): void {
  if (typeof window === "undefined") return;
  const evt = { action, at: new Date().toISOString(), detail };
  const list = loadStoredHistories();
  const updated = list.map((h) =>
    h.encounterId === encounterId ? { ...h, audit: [...(h.audit ?? []), evt] } : h
  );
  safeSetItem(KEY, JSON.stringify(updated));
  notifyHistoriesChanged();
  // LOCAL ONLY — do not sync via the outbox. The kiosk has no staff session,
  // so a PATCH here always 401s and leaves a permanent "waiting to sync"
  // banner on the done page. Server-side audit for staff actions goes through
  // recordAuditServer() / the authenticated PATCH handler instead.
}

export async function exportFhir(history: StoredHistory): Promise<void> {
  const res = await fetch("/api/fhir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(history),
  });
  if (!res.ok) throw new Error("FHIR export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medikiosk-${history.history.name.replace(/\s+/g, "-").toLowerCase()}-fhir.json`;
  a.click();
  URL.revokeObjectURL(url);
  recordAudit(history.encounterId, "exported", "FHIR bundle downloaded");
}

/** Seed demo records locally (BrowserChannel sync) and on the server. */
export function seedDemoPatients(): void {
  if (typeof window === "undefined") return;
  const demo = buildDemoPatients();
  const existing = loadStoredHistories();
  const demoIds = new Set(demo.map((d) => d.encounterId));
  const filteredExisting = existing.filter((e) => !demoIds.has(e.encounterId));
  const merged = [...filteredExisting, ...demo];
  safeSetItem(KEY, JSON.stringify(merged));
  notifyHistoriesChanged();
  // The seed endpoint is admin-only with an empty body: it must NEVER go
  // through the offline outbox. A background flush carries no admin-session
  // guarantee, so a seed tapped by a non-admin (or after logout) 403s with
  // "Admins only." on every attempt and wedges the sync banner on a
  // permanent failure — for something that was never patient data. Fire it
  // directly instead; failure just means an admin can seed later.
  void fetch("/api/encounters/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {
    /* best effort — local demo records are already written above */
  });
}

/** Fetch server encounters and merge into the local list (server wins on newer updatedAt). */
export async function fetchServerEncounters(): Promise<StoredHistory[]> {
  if (typeof window === "undefined") return [];
  const res = await fetch("/api/encounters", { cache: "no-store" });
  if (!res.ok) return loadStoredHistories();
  const json = (await res.json()) as { ok: boolean; encounters?: StoredHistory[] };
  const server = json.encounters ?? [];
  if (!server.length) return loadStoredHistories();
  const local = loadStoredHistories();
  const byId = new Map<string, StoredHistory>();
  for (const e of [...local, ...server]) {
    const prev = byId.get(e.encounterId);
    if (!prev || new Date(e.updatedAt ?? 0) >= new Date(prev.updatedAt ?? 0)) {
      byId.set(e.encounterId, e);
    }
  }
  const merged = Array.from(byId.values());
  safeSetItem(KEY, JSON.stringify(merged));
  cachedHistoriesRaw = null;
  return merged;
}

/** Remove an encounter locally and (if permitted) on the server. */
export function deleteHistory(encounterId: string): void {
  if (typeof window === "undefined") return;
  try {
    const list = loadStoredHistories().filter((h) => h.encounterId !== encounterId);
    safeSetItem(KEY, JSON.stringify(list));
    notifyHistoriesChanged();
  } catch {
    // Storage failure must not block the server-side delete.
  }
  enqueueOutbox(`/api/encounters/${encodeURIComponent(encounterId)}`, "DELETE", null);
  void flushOutbox();
}