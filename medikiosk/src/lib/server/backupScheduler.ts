import "server-only";
import { takeBackup } from "./db";
import { log } from "./log";

/**
 * Scheduled backups (Batch D, R4).
 *
 * Runs in the server process: every MEDIKIOSK_BACKUP_INTERVAL_MIN (default 6
 * hours; ≥1 min enforced) it snapshots the encounter store into data/backups
 * with a SHA-256 sidecar and 7-file retention. First route that imports this
 * module arms the timer (there is no separate server bootstrap file); it is
 * unref'd so it never keeps the process alive on its own.
 */

const INTERVAL_MIN = Number(process.env.MEDIKIOSK_BACKUP_INTERVAL_MIN || 360);
let armed = false;

export function ensureBackupScheduler(): void {
  if (armed || !Number.isFinite(INTERVAL_MIN) || INTERVAL_MIN <= 0) return;
  armed = true;
  const ms = Math.max(60_000, INTERVAL_MIN * 60_000);
  const timer = setInterval(() => {
    takeBackup()
      .then((b) => log("info", "backup", "scheduled backup complete", { filename: b.filename, bytes: b.bytes }))
      .catch((err) => log("error", "backup", "scheduled backup failed", { error: String(err) }));
  }, ms);
  if (typeof timer.unref === "function") timer.unref();
  log("info", "backup", "backup scheduler armed", { intervalMinutes: INTERVAL_MIN, everyMs: ms });
}

/** Config used by the admin page + health check to surface backup scheduling. */
export function backupScheduleInfo(): { armed: boolean; intervalMinutes: number } {
  return {
    armed,
    intervalMinutes: INTERVAL_MIN > 0 ? INTERVAL_MIN : 0,
  };
}