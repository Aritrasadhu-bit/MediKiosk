import { describe, expect, it, beforeAll } from "vitest";
import { isWalkInWithoutAbha } from "@/lib/types";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Returning-patient + pending-duplicate lookup against a real (temporary)
 * store.
 *
 * The mobile fallback regressed once before: the walk-in check compared the
 * digit-normalised ABHA against the literal "newregister", which normalisation
 * can never produce — so mobile-only lookup silently found nothing and every
 * walk-in re-registered as new. These tests run against the real db module
 * pointed at a temp dir so the matching logic itself is exercised, not a mock
 * of it.
 */

const dir = mkdtempSync(join(tmpdir(), "medikiosk-test-"));
process.env.MEDIKIOSK_DATA_DIR = dir;

let db: typeof import("@/lib/server/db");

beforeAll(async () => {
  db = await import("@/lib/server/db");
});

function walkIn(id: string, mobile: string, enteredAt = new Date().toISOString()) {
  return {
    encounterId: id,
    updatedAt: enteredAt,
    enteredAt,
    mode: "allopathic",
    patient: {
      name: "Walk In",
      age: 30,
      sex: "Male",
      abhaId: "NEW-REGISTER",
      mobile,
      department: "General Medicine",
    },
    history: { chiefComplaint: "fever" },
    documents: [],
    redFlags: [],
    interactions: [],
    audit: [],
    summary: "",
    consentGranted: true,
    status: "pending",
  };
}

describe("returning-patient lookup", () => {
  it("finds a walk-in record by mobile plus matching name", async () => {
    await db.upsertEncounter(walkIn("enc-walk-1", "9876500001") as never);
    const found = await db.findReturningPatient(undefined, "9876500001", "Walk In");
    expect(found?.encounterId).toBe("enc-walk-1");
  });

  it("refuses a mobile-only lookup when the name does not match", async () => {
    expect(await db.findReturningPatient(undefined, "9876500001", "Someone Else")).toBeNull();
    expect(await db.findReturningPatient(undefined, "9876500001")).toBeNull();
  });

  it("finds a still-pending duplicate by mobile plus matching name", async () => {
    const dup = await db.findPendingDuplicate(undefined, "9876500001", "walk  in");
    expect(dup?.encounterId).toBe("enc-walk-1");
  });

  it("refuses a pending-duplicate lookup on name mismatch", async () => {
    expect(await db.findPendingDuplicate(undefined, "9876500001", "Someone Else")).toBeNull();
  });

  it("does not match a different mobile", async () => {
    expect(await db.findReturningPatient(undefined, "9000000000", "Walk In")).toBeNull();
    expect(await db.findPendingDuplicate(undefined, "9000000000", "Walk In")).toBeNull();
  });

  it("recognises walk-in spellings and missing ABHAs", () => {
    expect(isWalkInWithoutAbha("NEW-REGISTER")).toBe(true);
    expect(isWalkInWithoutAbha("newregister")).toBe(true);
    expect(isWalkInWithoutAbha("CAMP-REGISTER")).toBe(true);
    // An empty/missing id literally means "no ABHA on file", so mobile
    // fallback applies — matching the documented lookup contract.
    expect(isWalkInWithoutAbha("")).toBe(true);
    expect(isWalkInWithoutAbha(undefined)).toBe(true);
    expect(isWalkInWithoutAbha("11-0000-0001-2349")).toBe(false);
  });
});
