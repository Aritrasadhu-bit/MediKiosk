import "server-only";

import { promises as fs } from "fs";
import path from "path";

/**
 * Emergency break-glass activations.
 *
 * A consent-revoked record is withheld from every staff surface — which is
 * correct until the patient arrives unconscious and the team needs the record
 * to save them. A break-glass activation opens a narrow, time-boxed exception:
 * for BREAK_GLASS_WINDOW_MS after activation, the named encounter becomes
 * readable via `getEncounterForStaffOrBreakGlass`, and every such read is
 * audit-logged as an override.
 *
 * Design points:
 * - Activations persist in the data dir (a restart must not silently extend
 *   or erase an open window — the timestamps are absolute).
 * - The window is short (15 min): long enough for resuscitation, short enough
 *   that a forgotten badge does not become a standing exemption.
 * - Listing is admin-only and doubles as the review queue the override dialog
 *   promises ("reported to the Medical Superintendent").
 */

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "break-glass.json");

export const BREAK_GLASS_WINDOW_MS = 15 * 60 * 1000;

export type BreakGlassActivation = {
  /** Null = global activation (opens the override list); set = named record. */
  encounterId: string | null;
  by: string;
  role: string;
  reason: string;
  at: string;
};

let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readAll(): Promise<BreakGlassActivation[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BreakGlassActivation[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(list: BreakGlassActivation[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fs.rename(tmp, FILE);
}

/** Record an activation; prunes long-expired entries as it writes. */
export async function recordBreakGlassActivation(entry: BreakGlassActivation): Promise<void> {
  return withLock(async () => {
    const all = await readAll();
    const cutoff = Date.now() - BREAK_GLASS_WINDOW_MS;
    const live = all.filter((a) => Date.parse(a.at) > cutoff);
    live.push(entry);
    await writeAll(live);
  });
}

/** True when a live (unexpired) activation covers this encounter. */
export async function breakGlassActiveFor(encounterId: string, now = Date.now()): Promise<boolean> {
  const all = await readAll();
  return all.some(
    (a) =>
      (a.encounterId === null || a.encounterId === encounterId) &&
      now - Date.parse(a.at) <= BREAK_GLASS_WINDOW_MS
  );
}

/** True when ANY live activation exists (drives the override list). */
export async function anyBreakGlassActive(now = Date.now()): Promise<boolean> {
  const all = await readAll();
  return all.some((a) => now - Date.parse(a.at) <= BREAK_GLASS_WINDOW_MS);
}

/** Admin review queue: newest first. */
export async function listBreakGlassActivations(): Promise<BreakGlassActivation[]> {
  const all = await readAll();
  return [...all].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
