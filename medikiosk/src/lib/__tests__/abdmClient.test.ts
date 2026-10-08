import { describe, expect, it, vi, afterEach } from "vitest";
import {
  abdmLiveConfig,
  abdmLiveConfigured,
  verifyHealthIdLive,
  submitConsentLive,
} from "@/lib/server/abdmClient";

/**
 * ABDM live-gateway seam.
 *
 * Default deployments stay `sandbox-local` (nothing leaves the hospital);
 * pointing at a bridge flips calls live. The seam must fail back to local
 * artefacts on any misconfiguration or outage — never throw, never claim a
 * delivery that did not happen.
 */

const LIVE_ENV = {
  ABDM_GATEWAY_MODE: "live",
  ABDM_BRIDGE_URL: "https://bridge.hospital.example/abdm",
  ABDM_CLIENT_ID: "hip-client",
  ABDM_CLIENT_SECRET: "s3cret",
};

async function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<unknown>) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("abdmLiveConfigured", () => {
  it("stays sandbox-local by default", async () => {
    await withEnv(
      { ABDM_GATEWAY_MODE: undefined, ABDM_BRIDGE_URL: undefined, ABDM_CLIENT_ID: undefined, ABDM_CLIENT_SECRET: undefined },
      () => {
        expect(abdmLiveConfig().mode).toBe("sandbox-local");
        expect(abdmLiveConfigured()).toBe(false);
      }
    );
  });

  it("requires the full bridge credentials, not just the mode flag", async () => {
    await withEnv({ ...LIVE_ENV, ABDM_CLIENT_SECRET: undefined }, () => {
      expect(abdmLiveConfigured()).toBe(false);
    });
    await withEnv(LIVE_ENV, () => {
      expect(abdmLiveConfigured()).toBe(true);
    });
  });
});

describe("live calls", () => {
  it("returns null without configuration (callers keep local artefacts)", async () => {
    await withEnv({ ABDM_GATEWAY_MODE: undefined }, async () => {
      expect(await verifyHealthIdLive("11-0000-0001-2349")).toBeNull();
      expect(await submitConsentLive({})).toBeNull();
    });
  });

  it("posts verify + consent to the bridge when live", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).endsWith("/verify-health-id")
          ? { valid: true, reason: "ok", gateway: "live" }
          : { ok: true, gatewayConsentId: "gw-123", status: "REQUESTED" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await withEnv(LIVE_ENV, async () => {
      const v = await verifyHealthIdLive("11-0000-0001-2349");
      expect(v).toMatchObject({ valid: true });
      const r = await submitConsentLive({ txnId: "txn-1" });
      expect(r).toMatchObject({ ok: true, gatewayConsentId: "gw-123" });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("https://bridge.hospital.example/abdm/verify-health-id");
  });

  it("falls back to null on bridge outage instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );
    await withEnv(LIVE_ENV, async () => {
      expect(await verifyHealthIdLive("11-0000-0001-2349")).toBeNull();
      expect(await submitConsentLive({})).toBeNull();
    });
  });

  it("falls back to null on non-2xx instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })));
    await withEnv(LIVE_ENV, async () => {
      expect(await submitConsentLive({})).toBeNull();
    });
  });
});
