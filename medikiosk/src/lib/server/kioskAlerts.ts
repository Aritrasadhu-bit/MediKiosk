import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { KioskHeartbeat } from "./heartbeats";

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "kiosk-alerts.json");

/** Minutes without a heartbeat before a kiosk counts as silent. */
export const SILENT_AFTER_MS = 5 * 60_000;
/** Minimum gap between repeat alerts for the same kiosk + condition. */
const ALERT_COOLDOWN_MS = 30 * 60_000;

type AlertState = {
  webhookUrl: string;
  /** "kioskId:kind" -> ISO time of last sent alert. */
  lastAlert: Record<string, string>;
};

async function readState(): Promise<AlertState> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AlertState>;
    return {
      webhookUrl: typeof parsed.webhookUrl === "string" ? parsed.webhookUrl : "",
      lastAlert: parsed.lastAlert && typeof parsed.lastAlert === "object" ? parsed.lastAlert : {},
    };
  } catch {
    return { webhookUrl: "", lastAlert: {} };
  }
}

async function writeState(state: AlertState): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    /* best effort */
  }
}

export async function getAlertWebhook(): Promise<{ configured: boolean; maskedUrl: string }> {
  const { webhookUrl } = await readState();
  if (!webhookUrl) return { configured: false, maskedUrl: "" };
  try {
    const u = new URL(webhookUrl);
    return { configured: true, maskedUrl: `${u.protocol}//${u.host}/…` };
  } catch {
    return { configured: true, maskedUrl: "(invalid URL — replace it)" };
  }
}

export async function setAlertWebhook(url: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = url.trim().slice(0, 500);
  if (trimmed) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false, error: "Not a valid http(s) URL." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Only http(s) webhook URLs are accepted." };
    }
  }
  const state = await readState();
  await writeState({ ...state, webhookUrl: trimmed });
  return { ok: true };
}

/**
 * Evaluate fleet health and push Slack-style {text} alerts for kiosks that
 * went silent or are holding unsynced writes. 30-minute cooldown per
 * kiosk+condition so ops gets signal, not spam. Never throws.
 */
export async function evaluateFleetAlerts(
  kiosks: KioskHeartbeat[],
  now = Date.now()
): Promise<string[]> {
  const state = await readState();
  if (!state.webhookUrl) return [];
  const sent: string[] = [];
  const due: Array<{ key: string; text: string }> = [];
  for (const k of kiosks) {
    const silentMs = now - new Date(k.lastSeen).getTime();
    const lastSilent = state.lastAlert[`${k.kioskId}:silent`];
    if (silentMs > SILENT_AFTER_MS && (!lastSilent || now - new Date(lastSilent).getTime() > ALERT_COOLDOWN_MS)) {
      due.push({
        key: `${k.kioskId}:silent`,
        text: `MediKiosk fleet: kiosk ${k.kioskId} silent for ${Math.round(silentMs / 60_000)} min — check power/network.`,
      });
    }
    const lastBacklog = state.lastAlert[`${k.kioskId}:backlog`];
    if (k.pending > 0 && (!lastBacklog || now - new Date(lastBacklog).getTime() > ALERT_COOLDOWN_MS)) {
      due.push({
        key: `${k.kioskId}:backlog`,
        text: `MediKiosk fleet: kiosk ${k.kioskId} holding ${k.pending} unsynced write(s) — check connectivity.`,
      });
    }
  }
  for (const alert of due) {
    try {
      const res = await fetch(state.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: alert.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        state.lastAlert[alert.key] = new Date(now).toISOString();
        sent.push(alert.key);
      }
    } catch {
      /* provider down — retry on the next evaluation */
    }
  }
  if (sent.length) await writeState(state);
  return sent;
}
