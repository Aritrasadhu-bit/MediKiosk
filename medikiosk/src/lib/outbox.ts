"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Offline-first write queue ("outbox").
 *
 * Every kiosk mutation (submit / patch / audit / delete) is persisted to the
 * queue FIRST, then a flush attempts to deliver it to the server with
 * exponential backoff. If the hospital Wi-Fi drops mid-submission nothing is
 * lost — attempts resume automatically (online/online events + interval).
 *
 * Pure helpers (nextRetry, dueItems, mergePending) are exported for tests.
 */

const KEY = "medikiosk_outbox";
export const OUTBOX_EVENT = "medikiosk-sync";

export type OutboxItem = {
  id: string;
  endpoint: string;
  method: string;
  body: unknown;
  createdAt: string;
  attempt: number;
  nextTry: number;
  gaveUp?: boolean;
  lastError?: string;
};

type SyncState = {
  pending: number;
  syncing: boolean;
  failed: number;
  lastSyncAt: number | null;
  /** Human-readable reason from the first failed item, if any. */
  detail: string | null;
};

/**
 * Verdict for one delivery attempt. Permanent rejections must never burn
 * through the retry budget (or sit "syncing" forever): only network/timeout
 * and explicit retry signals (429/503/5xx) deserve backoff.
 */
export type DeliveryVerdict = "sent" | "processed" | "retry" | "dead";

export function verdictForStatus(status: number | null, method: string): DeliveryVerdict {
  if (status === null) return "retry"; // network error / timeout / abort
  if (status >= 200 && status < 300) return "sent";
  // A POST answered 409 means the server already holds (and locked) this
  // record — resending can never succeed, and nothing is lost. Drop it.
  if (status === 409 && method === "POST") return "processed";
  if (status === 429 || status === 503 || status >= 500) return "retry";
  // 400/401/403/404/405/410/422 (and non-POST 409s): retrying the identical
  // payload can never succeed — fail fast with the server's message instead
  // of looping into "waiting to sync" forever.
  return "dead";
}

export function backoffMillis(attempt: number): number {
  return Math.min(5_000 * 2 ** attempt, 5 * 60_000);
}

/**
 * Hard cap on queued items. A kiosk left offline for days must not build an
 * unbounded queue that thrashes the network on the next reconnect flush (or
 * overflows localStorage).
 */
export const MAX_OUTBOX_ITEMS = 200;

/**
 * Keep the queue bounded without losing pending patient writes: terminal
 * failure entries (gaveUp, never auto-retried) are evicted first as dead
 * weight, then the oldest pending items — their full record still lives in the
 * local store, so the patient's next offline write simply re-queues a fresh
 * entry for that encounter.
 */
export function enforceQuota(list: OutboxItem[]): OutboxItem[] {
  if (list.length <= MAX_OUTBOX_ITEMS) return list;
  const overflow = list.length - MAX_OUTBOX_ITEMS;
  const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const failures = sorted.filter((i) => i.gaveUp);
  const pending = sorted.filter((i) => !i.gaveUp);
  const dropFailures = Math.min(overflow, failures.length);
  const rest = [...failures.slice(dropFailures), ...pending];
  return rest.slice(overflow - dropFailures);
}

/** Number of attempts before we stop auto-retrying (items survive for manual retry). */
export const MAX_ATTEMPTS = 8;

export function nextRetry(attempt: number, now = Date.now()): number {
  return now + backoffMillis(attempt);
}

export function dueItems(items: OutboxItem[], now = Date.now()): OutboxItem[] {
  return items.filter((i) => !i.gaveUp && i.nextTry <= now);
}

/** Key used to de-duplicate queue entries (repeat saves replace the pending one). */
export function itemKey(item: Pick<OutboxItem, "method" | "endpoint" | "body">): string {
  let id = "";
  const b = item.body as { encounterId?: string; clientId?: string } | null;
  // Encounters key on their encounterId; offline camp captures key on the
  // per-patient clientId so each patient gets their OWN queue entry (they
  // previously all collapsed into "POST /api/camp#" and only the last one
  // survived a reconnect flush).
  if (b?.encounterId) id = b.encounterId;
  else if (b?.clientId) id = `client:${b.clientId}`;
  const m = /\/api\/encounters\/([^/]+)$/.exec(item.endpoint);
  if (!id && m) id = m[1];
  return `${item.method} ${item.endpoint.replace(/\/api\/encounters\/[^/]+$/, "/api/encounters/:id")}#${id}`;
}

/** Merge a new pending item into an existing one (PATCH bodies merge; POST replace). */
export function mergePending(existing: OutboxItem, next: OutboxItem): OutboxItem {
  if (existing.method === "PATCH" && next.method === "PATCH") {
    const a = existing.body as Record<string, unknown>;
    const b = next.body as Record<string, unknown>;
    const auditA = Array.isArray(a.audit) ? a.audit : [];
    const auditB = Array.isArray(b.audit) ? b.audit : [];
    return {
      ...existing,
      body: { ...a, ...b, audit: [...auditA, ...auditB] },
      nextTry: next.nextTry,
      gaveUp: false,
    };
  }
  return { ...existing, ...next, attempt: 0, gaveUp: false };
}

export function hydrateOutbox(): OutboxItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(list: OutboxItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full — best effort */
  }
}

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OUTBOX_EVENT));
}

export function enqueueOutbox(endpoint: string, method: string, body: unknown): string {
  const id = `ob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: OutboxItem = {
    id,
    endpoint,
    method,
    body,
    createdAt: new Date().toISOString(),
    attempt: 0,
    nextTry: 0,
  };
  const list = hydrateOutbox();
  const key = itemKey(item);
  const existing = list.find((i) => itemKey(i) === key);
  const next = existing ? mergePending(existing, item) : item;
  const deduped = existing ? list.map((i) => (i.id === existing.id ? next : i)) : [...list, next];
  persist(enforceQuota(deduped));
  notify();
  return existing?.id ?? next.id;
}

export function outboxCount(): number {
  return hydrateOutbox().length;
}

type DeliveryResult =
  | { ok: true }
  | { ok: false; status: number | null; message: string };

async function deliver(item: OutboxItem): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(item.endpoint, {
      method: item.method,
      headers: { "Content-Type": "application/json" },
      body: item.method === "GET" || item.method === "DELETE" ? undefined : JSON.stringify(item.body),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    // Capture WHY the server refused: the old code threw the status away and
    // every failure looked like "network", so a stuck banner could never be
    // diagnosed (and permanent 400/403/409s retried forever).
    let message = `server answered ${res.status}`;
    try {
      const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (json && typeof json.error === "string" && json.error.trim()) {
        message = json.error.trim().slice(0, 160);
      }
    } catch {
      /* keep the default */
    }
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: null, message: "no connection to the server" };
  } finally {
    clearTimeout(timer);
  }
}

let flushing = false;

/** Revive gave-up items so a manual "Retry now" actually resends them. */
export function reviveOutbox(now = Date.now()): number {
  if (typeof window === "undefined") return 0;
  const list = hydrateOutbox();
  let revived = 0;
  const next = list.map((i) => {
    if (!i.gaveUp) return i;
    revived += 1;
    return { ...i, gaveUp: false, attempt: 0, nextTry: now };
  });
  if (revived > 0) {
    persist(next);
    notify();
  }
  return revived;
}

/** Attempt to deliver every due item. Returns true when any item succeeded. */
export async function flushOutbox(now = Date.now()): Promise<number> {
  if (typeof window === "undefined" || flushing) return 0;
  // Offline is not a delivery failure: leave everything queued without
  // burning attempts, or a night without network converts pending writes
  // into a false "delivery failed — staff action needed".
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  flushing = true;
  let delivered = 0;
  try {
    let list = hydrateOutbox();
    for (const item of dueItems(list, now)) {
      // Quarantine: demo-seed requests must never have been queued (admin-only
      // endpoint, empty body, zero patient data). Drop legacy entries so one
      // seed tap long ago can't wedge the banner forever.
      if (item.method === "POST" && item.endpoint === "/api/encounters/seed") {
        list = list.filter((i) => i.id !== item.id);
        persist(list);
        continue;
      }
      const result = await deliver(item);
      list = hydrateOutbox();
      if (result.ok) {
        list = list.filter((i) => i.id !== item.id);
        delivered += 1;
      } else {
        const verdict = verdictForStatus(result.status, item.method);
        if (verdict === "processed") {
          list = list.filter((i) => i.id !== item.id);
          delivered += 1;
        } else if (verdict === "dead") {
          list = list.map((i) => (i.id === item.id ? { ...i, gaveUp: true, lastError: result.message } : i));
        } else {
          const attempt = item.attempt + 1;
          list = list.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  attempt,
                  gaveUp: attempt > MAX_ATTEMPTS,
                  nextTry: nextRetry(attempt, now),
                  lastError:
                    attempt > MAX_ATTEMPTS ? "reached max attempts — manual retry required" : result.message,
                }
              : i
          );
        }
      }
      persist(list);
    }
  } finally {
    flushing = false;
    notify();
  }
  return delivered;
}

/** React hook: pending/syncing state + automatic background flushing. */
export function useSyncStatus(): SyncState & { retryNow: () => void } {
  // Initial zeros (NOT outboxCount()): the server renders with an empty store,
  // so reading localStorage in the initializer makes the first client render
  // disagree with the server HTML whenever queued writes exist — a hydration
  // crash (SyncBanner renders banner vs null). The mount effect below calls
  // refresh() and corrects to the real counts right after hydration.
  const [state, setState] = useState<SyncState>(() => ({
    pending: 0,
    syncing: false,
    failed: 0,
    lastSyncAt: null,
    detail: null,
  }));
  const syncCount = useRef(0);

  const refresh = useCallback(() => {
    const list = hydrateOutbox();
    const pending = list.filter((i) => !i.gaveUp).length;
    const failedItems = list.filter((i) => i.gaveUp);
    setState({
      pending,
      syncing: false,
      failed: failedItems.length,
      lastSyncAt: syncCount.current,
      detail: failedItems[0]?.lastError ?? null,
    });
  }, []);

  const retryNow = useCallback(() => {
    setState((s) => ({ ...s, syncing: true }));
    // Gave-up items are excluded from auto-flush, so a manual retry must
    // revive them first — otherwise the button spins and nothing resends.
    reviveOutbox();
    void flushOutbox()
      .then((n) => {
        if (n > 0) syncCount.current = Date.now();
      })
      .catch(() => {})
      .finally(() => refresh());
  }, [refresh]);

  useEffect(() => {
    const run = () => {
      void flushOutbox()
        .then((n) => {
          if (n > 0) syncCount.current = Date.now();
        })
        .catch(() => {})
        .finally(() => refresh());
    };
    refresh();
    window.addEventListener(OUTBOX_EVENT, refresh);
    window.addEventListener("online", run);
    window.addEventListener("offline", refresh);
    const interval = window.setInterval(run, 15_000);
    // Attempt an immediate flush shortly after mount (page load on flaky wifi).
    const first = window.setTimeout(run, 800);
    return () => {
      window.removeEventListener(OUTBOX_EVENT, refresh);
      window.removeEventListener("online", run);
      window.removeEventListener("offline", refresh);
      window.clearInterval(interval);
      window.clearTimeout(first);
    };
  }, [refresh]);

  return { ...state, retryNow };
}