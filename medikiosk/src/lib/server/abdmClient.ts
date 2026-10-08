import "server-only";

import { log } from "./log";

/**
 * ABDM live-gateway seam.
 *
 * Out of the box MediKiosk runs `sandbox-local`: every ABDM payload is built
 * in the documented NDHM wire format but nothing leaves the hospital
 * (`delivered: false` on every response). Pointing the deployment at a real
 * gateway bridge flips individual calls to live without touching callers:
 *
 *   ABDM_GATEWAY_MODE=live
 *   ABDM_BRIDGE_URL=https://<hospital-bridge>/abdm
 *   ABDM_CLIENT_ID / ABDM_CLIENT_SECRET  (bridge credentials)
 *   ABDM_HIP_ID (defaults to the sandbox HIP id)
 *
 * The bridge contract is intentionally tiny (verify + submit-consent) so a
 * hospital can front the real NDHM APIs — HealthID verification, consent
 * manuscript submission to the Consent Manager — with a thin adapter. Every
 * live call is bounded by timeout, never throws, and returns null on any
 * failure so callers fall back to the local artefacts.
 */

export type AbdmLiveConfig = {
  mode: "sandbox-local" | "live";
  bridgeUrl: string;
  clientId: string;
  clientSecret: string;
  hipId: string;
  timeoutMs: number;
};

export function abdmLiveConfig(): AbdmLiveConfig {
  return {
    mode: process.env.ABDM_GATEWAY_MODE === "live" ? "live" : "sandbox-local",
    bridgeUrl: (process.env.ABDM_BRIDGE_URL ?? "").replace(/\/+$/, ""),
    clientId: process.env.ABDM_CLIENT_ID ?? "",
    clientSecret: process.env.ABDM_CLIENT_SECRET ?? "",
    hipId: process.env.ABDM_HIP_ID || "SBX-HIP-MEDIKIOSK-100001",
    timeoutMs: Number(process.env.ABDM_TIMEOUT_MS ?? 15_000),
  };
}

/** True when a live call can actually be attempted. */
export function abdmLiveConfigured(cfg: AbdmLiveConfig = abdmLiveConfig()): boolean {
  return cfg.mode === "live" && Boolean(cfg.bridgeUrl && cfg.clientId && cfg.clientSecret);
}

export type AbdmVerifyResult = { valid: boolean; reason: string; gateway: "live" };

async function postBridge<T>(cfg: AbdmLiveConfig, path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${cfg.bridgeUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ABDM-Client-Id": cfg.clientId,
        "X-ABDM-Client-Secret": cfg.clientSecret,
        "X-ABDM-HIP-Id": cfg.hipId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!res.ok) {
      log("warn", "abdm", "live gateway returned non-2xx — falling back to local artefacts", {
        path,
        status: res.status,
      });
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    log("warn", "abdm", "live gateway unreachable — falling back to local artefacts", {
      path,
      error: String(e),
    });
    return null;
  }
}

/**
 * Verify a HealthID against the live gateway. Returns null when unconfigured
 * or unreachable — callers then use the local Verhoeff check.
 */
export async function verifyHealthIdLive(
  abhaId: string,
  cfg: AbdmLiveConfig = abdmLiveConfig()
): Promise<AbdmVerifyResult | null> {
  if (!abdmLiveConfigured(cfg)) return null;
  return postBridge<AbdmVerifyResult>(cfg, "/verify-health-id", { abhaId, hipId: cfg.hipId });
}

export type AbdmConsentReceipt = {
  ok: boolean;
  gatewayConsentId?: string;
  status?: string;
  error?: string;
};

/**
 * Submit a consent manuscript to the live gateway. Returns null when
 * unconfigured or unreachable — callers keep the locally-built manuscript
 * (and must keep reporting `delivered: false`).
 */
export async function submitConsentLive(
  manuscript: Record<string, unknown>,
  cfg: AbdmLiveConfig = abdmLiveConfig()
): Promise<AbdmConsentReceipt | null> {
  if (!abdmLiveConfigured(cfg)) return null;
  return postBridge<AbdmConsentReceipt>(cfg, "/consent-request", manuscript);
}
