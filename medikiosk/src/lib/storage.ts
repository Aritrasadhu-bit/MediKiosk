"use client";

/**
 * Quota-safe localStorage writes.
 *
 * Kiosk scans (OCR text for multi-page PDFs) plus months of encounter
 * records can exhaust the ~5MB localStorage quota. A bare setItem then
 * throws, the catch swallows it, and the app believes data persisted that
 * did not. This helper retries once after stripping regenerable blob preview
 * URLs (never clinical data) and otherwise broadcasts STORAGE_FULL_EVENT so
 * the UI can warn loudly instead of failing silently.
 */

export const STORAGE_FULL_EVENT = "medikiosk-storage-full";

function stripBlobUrls(node: unknown): boolean {
  let stripped = false;
  if (Array.isArray(node)) {
    for (const v of node) stripped = stripBlobUrls(v) || stripped;
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "previewUrl" && typeof v === "string" && v.startsWith("blob:")) {
        delete (node as Record<string, unknown>)[k];
        stripped = true;
      } else {
        stripped = stripBlobUrls(v) || stripped;
      }
    }
  }
  return stripped;
}

function notifyFull(): void {
  try {
    window.dispatchEvent(new Event(STORAGE_FULL_EVENT));
  } catch {
    /* ignore */
  }
}

/** setItem that survives quota pressure; false only when truly unwritable. */
export function safeSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    /* quota (or disabled storage) — try the eviction retry below */
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!stripBlobUrls(parsed)) {
      notifyFull();
      return false;
    }
    window.localStorage.setItem(key, JSON.stringify(parsed));
    return true;
  } catch {
    notifyFull();
    return false;
  }
}
