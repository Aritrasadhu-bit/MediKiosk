import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Default-account policy.
 *
 * The demo accounts (admin/doctor/nurse/pharmacist) ship with passwords that
 * are printed in the README. Seeding them into a production data dir would
 * hand a clinical system four publicly known credentials, and the /setup wizard
 * only replaces the admin — the other three would survive it. These tests pin
 * the policy: production starts empty and additionally refuses the published
 * passwords even against a store seeded earlier.
 *
 * auth.ts reads DATA_DIR and NODE_ENV at module load, so the module is
 * imported fresh per environment with a temp data dir.
 */

type AuthModule = typeof import("@/lib/server/auth");

const realNodeEnv = process.env.NODE_ENV;

/** NODE_ENV is typed readonly; the policy under test is keyed off it. */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

async function loadAuth(nodeEnv: "production" | "test", dataDir: string): Promise<AuthModule> {
  setNodeEnv(nodeEnv);
  process.env.MEDIKIOSK_DATA_DIR = dataDir;
  // DATA_DIR and the seeding decision are read at module load, so the module
  // graph has to be re-evaluated for each (environment, data dir) pair.
  vi.resetModules();
  return (await import("@/lib/server/auth")) as AuthModule;
}

let root: string;
let prodDir: string;
let demoDir: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "medikiosk-auth-"));
  prodDir = path.join(root, "prod");
  demoDir = path.join(root, "demo");
});

afterAll(() => {
  setNodeEnv(realNodeEnv ?? "test");
  delete process.env.MEDIKIOSK_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe("default accounts in production", () => {
  it("starts with no users, so no published credential can open a session", async () => {
    const auth = await loadAuth("production", prodDir);
    expect(await auth.findUser("admin")).toBeNull();
    expect(await auth.findUser("doctor")).toBeNull();
    expect(await auth.verifyCredentials("admin", "admin123")).toBeNull();
    expect(await auth.verifyCredentials("doctor", "doctor123")).toBeNull();
    expect(await auth.verifyCredentials("pharmacist", "pharm123")).toBeNull();
    expect(await auth.verifyCredentials("nurse", "nurse123")).toBeNull();
  });

  it("still accepts the account the setup wizard creates", async () => {
    const auth = await loadAuth("production", path.join(root, "prod-setup"));
    await auth.setupInitialAdmin("ward.admin", "a-real-long-passphrase-9f3c");
    const user = await auth.verifyCredentials("ward.admin", "a-real-long-passphrase-9f3c");
    expect(user?.role).toBe("admin");
    expect(await auth.verifyCredentials("ward.admin", "admin123")).toBeNull();
  });

  it("refuses a demo password against a store that was seeded earlier", async () => {
    // Seed the demo accounts the way a development build does, then flip to
    // production — the check has to hold on the hash, not on how it was made.
    const demo = await loadAuth("test", demoDir);
    expect((await demo.verifyCredentials("doctor", "doctor123"))?.role).toBe("doctor");

    const prod = await loadAuth("production", demoDir);
    expect(await prod.verifyCredentials("doctor", "doctor123")).toBeNull();
  });
});

describe("default accounts in development", () => {
  it("seeds the demo accounts so the project runs after a clone", async () => {
    const auth = await loadAuth("test", path.join(root, "dev"));
    expect((await auth.verifyCredentials("admin", "admin123"))?.role).toBe("admin");
    expect((await auth.verifyCredentials("doctor", "doctor123"))?.role).toBe("doctor");
    expect((await auth.verifyCredentials("nurse", "nurse123"))?.role).toBe("nurse");
    expect((await auth.verifyCredentials("pharmacist", "pharm123"))?.role).toBe("pharmacist");
  });

  it("still rejects a wrong password for a demo account", async () => {
    const auth = await loadAuth("test", path.join(root, "dev"));
    expect(await auth.verifyCredentials("doctor", "doctor124")).toBeNull();
  });
});
