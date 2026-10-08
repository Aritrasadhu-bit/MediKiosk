import "server-only";

import { promises as fs } from "fs";
import net from "node:net";
import path from "path";
import { toFhirBundle } from "@/lib/fhirBundle";
import { buildOrUMessage } from "@/lib/hl7";
import type { StoredHistory } from "@/lib/types";
import { isScopeActive } from "@/lib/types";

// The wire-format builder lives in a pure module so it can be unit tested.
export { buildOrUMessage } from "@/lib/hl7";

/**
 * Hospital Information System / EMR integration.
 *
 * MediKiosk's stated job is to get a structured history into the hospital's
 * own record *before* the consultation. Two real transport options are
 * supported, both configured by environment variable:
 *
 *   MEDIKIOSK_HIS_MODE=fhir     POST the FHIR R4 Bundle to MEDIKIOSK_HIS_FHIR_URL
 *   MEDIKIOSK_HIS_MODE=hl7v2    Send an HL7 v2.x ORU^R01 over TCP (MLLP) to
 *                               MEDIKIOSK_HIS_HL7_HOST/PORT
 *   MEDIKIOSK_HIS_MODE=off      (default) no push — export only
 *
 * When no endpoint is configured this module reports `not_configured`, and the
 * UI says exactly that. The previous build showed an unconditional green
 * "Pushed to Hospital Information System" dot backed by no code at all, which
 * is the kind of claim that erodes a demo the moment anyone reads the code.
 *
 * Every attempt is written to an append-only delivery log so a failed or
 * unconfigured push is visible and auditable rather than papered over.
 */

export type HisDeliveryState =
  | "delivered"
  | "failed"
  | "not_configured"
  | "no_consent"
  | "skipped";

/** Client-safe projection of a delivery receipt (no endpoint internals). */
export type PublicHisDelivery = {
  state: HisDeliveryState;
  detail: string;
  at: string;
  /** How many attempts have been made — staff need this to judge a retry. */
  attempts?: number;
  /** HTTP status for FHIR mode. */
  status?: number;
};

export type HisDelivery = {
  state: HisDeliveryState;
  /** Human-readable, safe to show a patient or a clinician. */
  detail: string;
  at: string;
  /**
   * Which transport was used. Safe to disclose — audit entries need to say
   * "sent over FHIR" without naming the internal endpoint.
   */
  mode: HisTransport;
  /**
   * Internal FHIR base URL or `host:port` for HL7. Server-side only: it maps
   * the hospital's internal network and must never reach a browser or the
   * patient portal. Use `toPublicDelivery` before serialising.
   */
  endpoint?: string;
  /** HTTP status for FHIR mode. */
  status?: number;
  attempts?: number;
};

/**
 * Strip everything a browser must never see from a delivery receipt.
 *
 * `endpoint` is the internal FHIR base URL or the HL7 `host:port`. Leaking it
 * hands an attacker the internal network map of the hospital integration, so
 * it exists only in the server-side delivery log. `status` and `attempts` are
 * kept: they are what staff need to decide whether a retry is worth doing, and
 * they reveal nothing about the deployment.
 */
/**
 * Reduce a transport error to something safe to render in a patient- or
 * clinician-facing delivery detail.
 *
 * Node's `fetch` puts the full request URL in errors like
 * `TypeError: Failed to parse URL from https://his.internal/.../fhir`, and the
 * detail string is returned to the browser. Keep the useful part (a status
 * code, a timeout, a refused connection) and drop anything URL-shaped.
 */
function safeTransportError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stripped = raw.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "the hospital system");
  return stripped.length > 200 ? `${stripped.slice(0, 197)}...` : stripped;
}

export function toPublicDelivery(delivery: HisDelivery): PublicHisDelivery {
  return {
    state: delivery.state,
    detail: delivery.detail,
    at: delivery.at,
    attempts: delivery.attempts,
    status: delivery.status,
  };
}

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const LOG_FILE = path.join(DATA_DIR, "his-deliveries.json");

const MAX_ATTEMPTS = Number(process.env.MEDIKIOSK_HIS_MAX_ATTEMPTS ?? 3);
const TIMEOUT_MS = Number(process.env.MEDIKIOSK_HIS_TIMEOUT_MS ?? 10_000);

// ---------------------------------------------------------------- delivery log

type LogEntry = HisDelivery & { encounterId: string };

async function appendLog(entry: LogEntry): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    let existing: LogEntry[] = [];
    try {
      existing = JSON.parse(await fs.readFile(LOG_FILE, "utf8")) as LogEntry[];
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
    existing.push(entry);
    // Keep the last 500 deliveries.
    await fs.writeFile(LOG_FILE, JSON.stringify(existing.slice(-500), null, 2), "utf8");
  } catch (err) {
    console.error("[medikiosk] could not write HIS delivery log:", (err as Error).message);
  }
}

export async function listHisDeliveries(encounterId?: string): Promise<LogEntry[]> {
  try {
    const raw = JSON.parse(await fs.readFile(LOG_FILE, "utf8")) as LogEntry[];
    const all = Array.isArray(raw) ? raw : [];
    return encounterId ? all.filter((d) => d.encounterId === encounterId) : all;
  } catch {
    return [];
  }
}

export async function latestHisDelivery(encounterId: string): Promise<LogEntry | null> {
  const entries = await listHisDeliveries(encounterId);
  return entries.length ? entries[entries.length - 1] : null;
}

// ---------------------------------------------------------------- transports

/**
 * MLLP-framed TCP sender for HL7 v2. Returns the acknowledgement segment, or
 * throws. Kept dependency-free using node:net.
 */
function sendMllp(message: string, host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const startBlock = Buffer.from([0x0b]);
    const endBlock = Buffer.from([0x1c, 0x0d]);
    const payload = Buffer.concat([startBlock, Buffer.from(message, "utf8"), endBlock]);
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    const timer = setTimeout(() => fail(new Error("HIS HL7 connection timed out")), TIMEOUT_MS);

    socket.on("error", (err) => fail(err as Error));
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // An ACK is a complete MLLP frame.
      const end = buffer.indexOf(Buffer.from([0x1c, 0x0d]));
      if (end !== -1) {
        const frame = buffer.subarray(buffer.indexOf(Buffer.from([0x0b])) + 1, end).toString("utf8");
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        socket.end();
        resolve(frame);
      }
    });
    socket.on("close", () => {
      clearTimeout(timer);
      fail(new Error("HIS HL7 connection closed before acknowledgement"));
    });
  });
}

// ---------------------------------------------------------------- main entry

/** Which transport the deployment uses. `"off"` means no HIS is configured. */
export type HisTransport = "fhir" | "hl7v2" | "off";

export type HisConfig = {
  mode: HisTransport;
  fhirUrl?: string;
  hl7Host?: string;
  hl7Port?: number;
};

export function hisConfig(): HisConfig {
  const mode = (process.env.MEDIKIOSK_HIS_MODE ?? "off").toLowerCase();
  if (mode === "fhir") {
    return { mode: "fhir", fhirUrl: process.env.MEDIKIOSK_HIS_FHIR_URL };
  }
  if (mode === "hl7v2") {
    return {
      mode: "hl7v2",
      hl7Host: process.env.MEDIKIOSK_HIS_HL7_HOST,
      hl7Port: process.env.MEDIKIOSK_HIS_HL7_PORT ? Number(process.env.MEDIKIOSK_HIS_HL7_PORT) : undefined,
    };
  }
  return { mode: "off" };
}

export function hisConfigured(): boolean {
  const cfg = hisConfig();
  if (cfg.mode === "fhir") return Boolean(cfg.fhirUrl);
  if (cfg.mode === "hl7v2") return Boolean(cfg.hl7Host && cfg.hl7Port);
  return false;
}

/**
 * Push one encounter to the configured HIS. Never throws — callers get a
 * delivery record they can show honestly to the user.
 */
export async function pushEncounterToHis(
  h: StoredHistory,
  opts: { consentForExport?: boolean } = {}
): Promise<HisDelivery> {
  const at = new Date().toISOString();

  // Lawful basis: exporting to a third-party system needs its own consent
  // scope, not just the clinical-care consent that lets staff read the record.
  const allowed =
    opts.consentForExport ?? isScopeActive(h.consent, "his_emr_export");
  if (!allowed) {
    const delivery: HisDelivery = {
      state: "no_consent",
      detail: "Not sent — you did not consent to sharing this record with hospital systems.",
      at,
      mode: hisConfig().mode,
    };
    await appendLog({ ...delivery, encounterId: h.encounterId });
    return delivery;
  }

  const cfg = hisConfig();
  if (cfg.mode === "off" || !hisConfigured()) {
    const delivery: HisDelivery = {
      state: "not_configured",
      detail: "No hospital system is connected to this kiosk. Your record is saved here and ready to export.",
      at,
      mode: cfg.mode,
    };
    await appendLog({ ...delivery, encounterId: h.encounterId });
    return delivery;
  }

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (cfg.mode === "fhir") {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const res = await fetch(cfg.fhirUrl!, {
          method: "POST",
          headers: {
            "content-type": "application/fhir+json",
            accept: "application/fhir+json",
            // Credentials are optional; a real deployment puts them in a secret
            // store, never in the repo.
            ...(process.env.MEDIKIOSK_HIS_BEARER_TOKEN
              ? { authorization: `Bearer ${process.env.MEDIKIOSK_HIS_BEARER_TOKEN}` }
              : {}),
          },
          body: JSON.stringify(toFhirBundle(h)),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          throw new Error(`HIS responded ${res.status} ${res.statusText}`);
        }
        const delivery: HisDelivery = {
          state: "delivered",
          detail: "Sent to the hospital information system as a FHIR R4 record.",
          at: new Date().toISOString(),
          mode: "fhir",
          endpoint: cfg.fhirUrl,
          status: res.status,
          attempts: attempt,
        };
        await appendLog({ ...delivery, encounterId: h.encounterId });
        return delivery;
      }

      // HL7 v2 / MLLP
      const ack = await sendMllp(buildOrUMessage(h), cfg.hl7Host!, cfg.hl7Port!);
      // MSA-1 in the ACK: "AA"/"CA" are application accept.
      const msa = ack.split("|").find((s) => s.startsWith("MSA")) ?? "";
      const code = msa.split("|")[1] ?? "";
      if (code && !["AA", "CA"].includes(code)) {
        throw new Error(`HIS rejected the message (MSA-1=${code})`);
      }
      const delivery: HisDelivery = {
        state: "delivered",
        detail: "Sent to the hospital information system (HL7 v2 ORU^R01).",
        at: new Date().toISOString(),
        mode: "hl7v2",
        endpoint: `${cfg.hl7Host}:${cfg.hl7Port}`,
        attempts: attempt,
      };
      await appendLog({ ...delivery, encounterId: h.encounterId });
      return delivery;
    } catch (err) {
      lastError = safeTransportError(err);
      if (attempt < MAX_ATTEMPTS) {
        // Linear backoff; the queue/outbox layer retries the whole submission.
        await new Promise((r) => setTimeout(r, attempt * 500));
      }
    }
  }

  const delivery: HisDelivery = {
    state: "failed",
    detail: `Could not reach the hospital system (${lastError}). Your record is safe here and a staff member can send it.`,
    at: new Date().toISOString(),
    mode: cfg.mode,
    endpoint: cfg.mode === "fhir" ? cfg.fhirUrl : `${cfg.hl7Host}:${cfg.hl7Port}`,
    attempts: MAX_ATTEMPTS,
  };
  await appendLog({ ...delivery, encounterId: h.encounterId });
  return delivery;
}
