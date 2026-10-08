import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Break-glass activation windows.
 *
 * A revoked record opens only while a live (≤15 min) activation covers it.
 * Runs against the real store pointed at a temp dir.
 */

const dir = mkdtempSync(join(tmpdir(), "medikiosk-bg-test-"));
process.env.MEDIKIOSK_DATA_DIR = dir;

let bg: typeof import("@/lib/server/breakglass");

beforeAll(async () => {
  bg = await import("@/lib/server/breakglass");
});

describe("break-glass activations", () => {
  it("covers the encounter for 15 minutes after activation", async () => {
    await bg.recordBreakGlassActivation({
      encounterId: "enc-er-1",
      by: "dr",
      role: "doctor",
      reason: "Unconscious RTA victim",
      at: new Date().toISOString(),
    });
    expect(await bg.breakGlassActiveFor("enc-er-1")).toBe(true);
    expect(await bg.breakGlassActiveFor("enc-other")).toBe(false);
  });

  it("expires the window after 15 minutes", async () => {
    await bg.recordBreakGlassActivation({
      encounterId: "enc-old",
      by: "dr",
      role: "doctor",
      reason: "Old emergency",
      at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    });
    expect(await bg.breakGlassActiveFor("enc-old")).toBe(false);
  });

  it("lists activations newest-first for the admin review queue", async () => {
    const list = await bg.listBreakGlassActivations();
    const ids = list.map((a) => a.encounterId);
    expect(ids).toContain("enc-er-1");
    // Newest activation sorts first.
    expect(Date.parse(list[0].at) >= Date.parse(list[list.length - 1].at)).toBe(true);
  });
});
