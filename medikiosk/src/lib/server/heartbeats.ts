import "server-only";
import { promises as fs } from "fs";
import path from "path";

export type KioskHeartbeat = {
  kioskId: string;
  lastSeen: string;
  /** Queued (unsynced) outbox writes reported by the kiosk. */
  pending: number;
  /** Browser user-agent (device identification only, no PHI). */
  userAgent: string;
};

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "kiosk-heartbeats.json");

const MAX_KIOSKS = 50;

async function readAll(): Promise<Record<string, KioskHeartbeat>> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as { kiosks?: Record<string, KioskHeartbeat> };
    if (parsed && typeof parsed.kiosks === "object" && parsed.kiosks) return parsed.kiosks;
  } catch {
    /* missing or corrupt — start fresh */
  }
  return {};
}

/** Record a heartbeat. Never throws; never stores PHI. */
export async function recordHeartbeat(hb: KioskHeartbeat): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const all = await readAll();
    all[hb.kioskId] = hb;
    // Bound the file: drop the stalest entries beyond the cap.
    const ids = Object.keys(all).sort(
      (a, b) => new Date(all[a].lastSeen).getTime() - new Date(all[b].lastSeen).getTime()
    );
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_KIOSKS))) {
      delete all[id];
    }
    await fs.writeFile(FILE, JSON.stringify({ kiosks: all }, null, 2), "utf8");
  } catch {
    /* best effort — heartbeat must never break the kiosk */
  }
}

/** All known kiosks, most-recently-seen first. */
export async function listHeartbeats(): Promise<KioskHeartbeat[]> {
  const all = await readAll();
  return Object.values(all).sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
  );
}
