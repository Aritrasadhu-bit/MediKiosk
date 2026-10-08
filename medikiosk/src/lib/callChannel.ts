// Shared queue "Call Next" channel between kiosk screens and the physician dashboard.
// Uses BroadcastChannel (same-browser sync) with a localStorage fallback event so
// the demo works across tabs and devices that share the server.

export const CALL_CHANNEL = "medikiosk-call";

export type CallMessage = {
  action: "call-next";
  encounterId: string;
  name: string;
  token?: string;
  at: string;
};

export function publishCall(msg: CallMessage): void {
  if (typeof window === "undefined") return;
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CALL_CHANNEL);
    bc.postMessage(msg);
  } catch {
    // BroadcastChannel unavailable — fall back to a window event + storage ping.
    try {
      window.dispatchEvent(new CustomEvent(CALL_CHANNEL, { detail: msg }));
      window.localStorage.setItem(CALL_CHANNEL, JSON.stringify({ ...msg, __t: Date.now() }));
    } catch {
      /* best effort */
    }
  } finally {
    try {
      bc?.close();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeCalls(callback: (msg: CallMessage) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const bc = new BroadcastChannel(CALL_CHANNEL);
  const handler = (e: MessageEvent<CallMessage>) => callback(e.data);
  bc.addEventListener("message", handler);
  const localHandler = (e: Event) => {
    const detail = (e as CustomEvent<CallMessage>).detail;
    if (detail) callback(detail);
  };
  window.addEventListener(CALL_CHANNEL, localHandler);
  const storageHandler = (e: StorageEvent) => {
    if (e.key === CALL_CHANNEL && e.newValue) {
      try {
        callback(JSON.parse(e.newValue) as CallMessage);
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    bc.removeEventListener("message", handler);
    bc.close();
    window.removeEventListener(CALL_CHANNEL, localHandler);
    window.removeEventListener("storage", storageHandler);
  };
}