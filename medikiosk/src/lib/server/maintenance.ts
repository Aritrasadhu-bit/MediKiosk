import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { log } from "./log";

/**
 * Maintenance-mode flag (Batch D, R5).
 *
 * When maintenance is active (flag file `data/maintenance.json` or the
 * MEDIKIOSK_MAINTENANCE=1 env var), kiosk write endpoints respond 503 instead
 * of silently accepting data — the health check reports the mode and the admin
 * page shows a banner. This prevents "invisible data loss" when an operator
 * takes the store offline (backup window, migration, disk issue).
 */

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const MAINT_FILE = path.join(DATA_DIR, "maintenance.json");

export type MaintenanceState = {
  active: boolean;
  reason?: string;
  since?: string;
};

export async function readMaintenance(): Promise<MaintenanceState> {
  if (process.env.MEDIKIOSK_MAINTENANCE === "1") {
    return { active: true, reason: "MEDIKIOSK_MAINTENANCE=1 (env)" };
  }
  try {
    const raw = await fs.readFile(MAINT_FILE, "utf8");
    const parsed = JSON.parse(raw) as MaintenanceState;
    return { active: parsed.active === true, reason: parsed.reason, since: parsed.since };
  } catch {
    return { active: false };
  }
}

export async function setMaintenance(active: boolean, reason?: string): Promise<MaintenanceState> {
  const next: MaintenanceState = { active, reason, since: active ? new Date().toISOString() : undefined };
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!active) {
    await fs.rm(MAINT_FILE, { force: true }).catch(() => {});
  } else {
    await fs.writeFile(MAINT_FILE, JSON.stringify(next, null, 2), "utf8");
  }
  log("info", "maintenance", active ? "maintenance mode ON" : "maintenance mode OFF", { reason });
  return next;
}

/** True when writes should be refused (maintenance OR storage unwritable). */
export async function maintenanceActive(): Promise<boolean> {
  const state = await readMaintenance();
  return state.active;
}