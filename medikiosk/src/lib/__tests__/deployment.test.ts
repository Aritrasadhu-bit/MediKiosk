import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildInfo } from "@/lib/server/buildInfo";

/**
 * Deployment evidence: image provenance + drill persistence.
 *
 * - buildInfo() reports the baked image build, or the "dev" fallback when no
 *   image metadata exists (plain next dev/start). The repo must never contain
 *   a build-info.json, or every dev machine would misreport itself.
 * - The restore-drill outcome persists across reloads for the admin panel.
 */

const dir = mkdtempSync(join(tmpdir(), "medikiosk-deploy-test-"));
process.env.MEDIKIOSK_DATA_DIR = dir;

let db: typeof import("@/lib/server/db");

beforeAll(async () => {
  db = await import("@/lib/server/db");
});

describe("buildInfo", () => {
  it("falls back to the dev build without baked image metadata", async () => {
    const info = await buildInfo();
    expect(info.id).toBe("dev");
    expect(info.time).toBeNull();
  });
});

describe("drill persistence", () => {
  it("starts with no drill on a fresh data dir", async () => {
    expect(await db.readLastDrill()).toBeNull();
  });

  it("round-trips the latest drill outcome", async () => {
    await db.recordDrillResult({
      at: "2026-10-01T00:00:00.000Z",
      by: "admin",
      target: "medikiosk-backup-x.json",
      restored: 3,
      ok: true,
    });
    const last = await db.readLastDrill();
    expect(last).toMatchObject({ by: "admin", restored: 3, ok: true });
  });
});
