import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Capability-URL lifecycle for stored scans.
 *
 * Upload links are unauthenticated by design, so they must not live forever:
 * every upload carries a 30-day expiry, the first download is audit-stamped,
 * and expired bytes are reclaimed on access. Runs against the real store
 * pointed at a temp dir.
 */

const dir = mkdtempSync(join(tmpdir(), "medikiosk-upload-test-"));
process.env.MEDIKIOSK_DATA_DIR = dir;

let db: typeof import("@/lib/server/db");

beforeAll(async () => {
  db = await import("@/lib/server/db");
});

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("upload capability lifecycle", () => {
  it("serves a fresh upload and stamps the first download", async () => {
    const saved = await db.saveUpload(tinyPngBase64, "scan.png", "image/png");
    expect(saved).not.toBeNull();
    const meta = JSON.parse(readFileSync(join(dir, "uploads", `${saved!.id}.json`), "utf8"));
    expect(Date.parse(meta.expiresAt)).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
    expect(meta.downloadedAt).toBeUndefined();

    const got = await db.getUpload(saved!.id);
    expect(got?.mime).toBe("image/png");
    expect(got?.data.length).toBeGreaterThan(0);

    const stamped = JSON.parse(readFileSync(join(dir, "uploads", `${saved!.id}.json`), "utf8"));
    expect(typeof stamped.downloadedAt).toBe("string");
  });

  it("refuses an expired upload and reclaims its bytes", async () => {
    const saved = await db.saveUpload(tinyPngBase64, "old.png", "image/png");
    expect(saved).not.toBeNull();
    const sidecar = join(dir, "uploads", `${saved!.id}.json`);
    const meta = JSON.parse(readFileSync(sidecar, "utf8"));
    writeFileSync(
      sidecar,
      JSON.stringify({ ...meta, expiresAt: new Date(Date.now() - 1000).toISOString() }),
      "utf8"
    );

    expect(await db.getUpload(saved!.id)).toBeNull();
    expect(existsSync(sidecar)).toBe(false);
    expect(existsSync(join(dir, "uploads", `${saved!.id}.png`))).toBe(false);
  });

  it("grandfathers uploads that predate expiry metadata", async () => {
    // Files written before sidecars existed have no expiry — they keep
    // working rather than breaking links already embedded in old records.
    const saved = await db.saveUpload(tinyPngBase64, "legacy.png", "image/png");
    expect(saved).not.toBeNull();
    const sidecar = join(dir, "uploads", `${saved!.id}.json`);
    const meta = JSON.parse(readFileSync(sidecar, "utf8"));
    delete meta.expiresAt;
    writeFileSync(sidecar, JSON.stringify(meta), "utf8");

    const got = await db.getUpload(saved!.id);
    expect(got?.data.length).toBeGreaterThan(0);
  });
});
