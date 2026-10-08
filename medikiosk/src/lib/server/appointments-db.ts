import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Appointment booking store (JSON file, same crash-safe discipline as db.ts).
 * Slot bookings are created from the waiting room / home, then checked in at
 * the kiosk — see /api/appointments and /identify.
 */

export type AppointmentStatus = "booked" | "checked-in" | "cancelled";

export type Appointment = {
  id: string;
  name: string;
  mobile: string;
  department: string;
  /** YYYY-MM-DD */
  date: string;
  /** Slot label, e.g. "10:00" or "Slide 3". */
  slot: string;
  status: AppointmentStatus;
  createdAt: string;
  checkedInAt?: string;
  /** Last reminder SMS sent (ISO). Absence means never reminded. */
  remindedAt?: string;
};

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "appointments.json");

let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function ensureFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(FILE);
  } catch {
    await fs.writeFile(FILE, "[]", "utf8");
  }
}

export async function listAppointments(): Promise<Appointment[]> {
  await ensureFile();
  const candidates = [FILE, `${FILE}.bak`];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(/*turbopackIgnore: true*/ candidate, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Appointment[];
    } catch {
      /* unreadable — try the .bak copy, else []; a torn main write must not
         hide previously-saved appointments */
    }
  }
  return [];
}

export async function getAppointmentById(id: string): Promise<Appointment | null> {
  const all = await listAppointments();
  return all.find((a) => a.id === id) ?? null;
}

async function writeAll(list: Appointment[]): Promise<void> {
  await ensureFile();
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fs.rename(tmp, FILE);
  await fs.copyFile(FILE, `${FILE}.bak`).catch(() => {});
}

/** Normalise a person name for comparison (case/whitespace-insensitive). */
export function normalizePersonName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function findAppointments(mobile: string, date?: string, name?: string): Promise<Appointment[]> {
  // Two-factor lookup is enforced HERE, not just in the route: a mobile
  // number alone must never open someone else's bookings, whichever caller
  // asks. No name → no match, full stop.
  const wantName = name ? normalizePersonName(name) : null;
  if (!wantName) return [];
  const all = await listAppointments();
  const phone = mobile.replace(/[^0-9]/g, "");
  return all.filter(
    (a) =>
      a.mobile.replace(/[^0-9]/g, "") === phone &&
      (!date || a.date === date) &&
      a.status !== "cancelled" &&
      normalizePersonName(a.name) === wantName
  );
}

export async function upsertAppointment(input: {
  name: string;
  mobile: string;
  department: string;
  date: string;
  slot: string;
}): Promise<Appointment> {
  const phone = input.mobile.replace(/[^0-9]/g, "");
  if (phone.length < 10) throw new Error("A valid 10-digit mobile is required.");
  return withLock(async () => {
    const all = await listAppointments();
    const existing = all.find(
      (a) => a.mobile.replace(/[^0-9]/g, "") === phone && a.date === input.date && a.slot === input.slot && a.status === "booked"
    );
    if (existing) return existing;
    const appt: Appointment = {
      id: randomUUID(),
      name: input.name,
      mobile: phone,
      department: input.department,
      date: input.date,
      slot: input.slot,
      status: "booked",
      createdAt: new Date().toISOString(),
    };
    await writeAll([...all, appt]);
    return appt;
  });
}

/** Booked, not cancelled/checked-in appointments for a date (YYYY-MM-DD). */
export async function bookedForDate(date: string): Promise<Appointment[]> {
  const all = await listAppointments();
  return all.filter((a) => a.date === date && a.status === "booked");
}

/** Stamp remindedAt on the given ids (idempotent — safe to re-run). */
export async function markReminded(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const wanted = new Set(ids);
  return withLock(async () => {
    const all = await listAppointments();
    let changed = false;
    for (const a of all) {
      if (wanted.has(a.id) && !a.remindedAt) {
        a.remindedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await writeAll(all);
  });
}

export async function checkInAppointment(id: string): Promise<Appointment | null> {
  return withLock(async () => {
    const all = await listAppointments();
    const idx = all.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    if (all[idx].status !== "booked") return all[idx];
    all[idx] = {
      ...all[idx],
      status: "checked-in",
      checkedInAt: new Date().toISOString(),
    };
    await writeAll(all);
    return all[idx];
  });
}

export async function resetAppointments(): Promise<void> {
  return withLock(async () => {
    await ensureFile();
    await writeAll([]);
  });
}