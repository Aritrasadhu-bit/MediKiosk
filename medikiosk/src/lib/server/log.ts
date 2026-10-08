import "server-only";
import { promises as fs } from "fs";
import path from "path";

/**
 * Minimal structured logger.
 *
 * - Appends JSON-lines to data/logs/app.log (survives process restarts).
 * - Keeps an in-memory ring of the most recent errors, surfaced by /api/health
 *   so ops can see kiosk sync failures without reading log files.
 */

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const LOG_DIR = path.join(DATA_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const lastErrors: { at: string; scope: string; message: string }[] = [];
const MAX_ERRORS = 10;

let writeQueue: Promise<unknown> = Promise.resolve();

export function log(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
  const entry = {
    level,
    scope,
    message,
    at: new Date().toISOString(),
    ...(fields ?? {}),
  };
  // Console for dev ergonomics.
  if (level === "error") console.error(`[${scope}]`, message, fields ?? "");
  else if (level === "warn") console.warn(`[${scope}]`, message, fields ?? "");
  else console.log(`[${scope}]`, message, fields ?? "");

  if (level === "error") {
    lastErrors.unshift({ at: entry.at, scope, message });
    if (lastErrors.length > MAX_ERRORS) lastErrors.pop();
  }

  // Append asynchronously, serialized to avoid interleaved writes. A failed
  // append is reported instead of being silently dropped — a read-only or full
  // data dir must surface, not quietly stop logging.
  writeQueue = writeQueue
    .then(async () => {
      await fs.mkdir(LOG_DIR, { recursive: true });
      await fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
    })
    .catch((err) => {
      console.error(`[log] failed to append to ${LOG_FILE}:`, err instanceof Error ? err.message : String(err));
    });
}

export function recentErrors(): { at: string; scope: string; message: string }[] {
  return [...lastErrors];
}

/** Wrap an async call so unexpected errors are logged with context. */
export async function withLog<T>(
  scope: string,
  fn: () => Promise<T>,
  message = "operation failed"
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    log("error", scope, message, { error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}