import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Appointment lookup is two-factor: a mobile number alone must not open
 * someone else's bookings (name + department + slot leaks health
 * information). The name has to match the booking. Runs against the real
 * store pointed at a temp dir.
 */

const dir = mkdtempSync(join(tmpdir(), "medikiosk-apt-test-"));
process.env.MEDIKIOSK_DATA_DIR = dir;

let store: typeof import("@/lib/server/appointments-db");

beforeAll(async () => {
  store = await import("@/lib/server/appointments-db");
});

const BOOKING = {
  name: "Portal Test Patient",
  mobile: "9876501234",
  department: "General Medicine",
  date: "2026-10-02",
  slot: "11:30-12:00",
};

describe("appointment two-factor lookup", () => {
  it("returns the booking when mobile and name both match", async () => {
    const created = await store.upsertAppointment({ ...BOOKING });
    const found = await store.findAppointments("9876501234", "2026-10-02", "portal test patient");
    expect(found.map((a) => a.id)).toContain(created.id);
  });

  it("reveals nothing when the name does not match", async () => {
    const found = await store.findAppointments("9876501234", "2026-10-02", "Some Other Person");
    expect(found).toEqual([]);
  });

  it("reveals nothing when no name is supplied", async () => {
    // The public route rejects this with 400; the store treats a missing
    // name as "no match" so a direct caller cannot bypass the gate either.
    const found = await store.findAppointments("9876501234", "2026-10-02");
    expect(found).toEqual([]);
  });
});

describe("reminder bookkeeping", () => {
  it("lists booked visits for a date and marks them reminded idempotently", async () => {
    const created = await store.upsertAppointment({ ...BOOKING, date: "2026-11-01", slot: "09:00" });
    expect(await store.bookedForDate("2026-11-01")).toHaveLength(1);
    await store.markReminded([created.id]);
    await store.markReminded([created.id]); // re-run must not error or duplicate
    const [row] = await store.bookedForDate("2026-11-01");
    expect(typeof row.remindedAt).toBe("string");
  });

  it("ignores unknown ids", async () => {
    await expect(store.markReminded(["no-such-id"])).resolves.toBeUndefined();
  });
});
