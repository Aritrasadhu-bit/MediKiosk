import { NextResponse } from "next/server";
import { readSettings } from "@/lib/server/settings";
import { currentUser } from "@/lib/server/auth";
import { buildInfo } from "@/lib/server/buildInfo";

export const runtime = "nodejs";

/**
 * Capability discovery for clients.
 *
 * Two audiences with very different needs:
 *
 *  - The patient-facing kiosk (unauthenticated) needs a handful of flags to
 *    decide what to render and which speech transport to use.
 *  - The admin screen needs the deployment's security posture.
 *
 * The security-posture fields are gated behind authentication. Serving them
 * publicly was handing an attacker the reconnaissance they want most:
 * `phiEncrypted: false` tells them patient records sit on disk in plaintext,
 * and `llm: true` tells them this instance will spend an operator's metered
 * API key on their behalf. Capability flags that merely describe what the UI
 * can do are fine; anything describing how weak or rich this deployment is,
 * is not.
 */
export async function GET() {
  const settings = await readSettings();
  const user = await currentUser();
  const isStaff = Boolean(user);
  const build = await buildInfo();

  return NextResponse.json({
    ok: true,
    version: "2.3.0",
    build,
    hospital: {
      name: settings.hospitalName,
      departments: settings.departments,
      configured: settings.configured,
    },
    capabilities: {
      // Required by `getCapabilities()` in src/lib/speech.ts to decide between
      // the backend ASR and the browser's Web Speech fallback. Naming the
      // vendor is mild recon, but the kiosk genuinely cannot work without it.
      asrBackend: Boolean(process.env.AI4BHARAT_ASR_URL || process.env.BHASHINI_API_KEY),
      asrProvider: process.env.AI4BHARAT_ASR_URL
        ? "ai4bharat"
        : process.env.BHASHINI_API_KEY
        ? "bhashini"
        : "web-speech",
      fhir: true,
      abdmSimulated: true,
      ocrMultiLanguage: true,
      ocrPdf: true,
      queue: "public-display",
      notifications: {
        sms: Boolean(process.env.SMS_PROVIDER_URL),
        stub: true,
      },
      uploads: "server",
      earlyWarning: "mews-age-aware",
      queuePosition: true,
      appointmentBooking: true,
      aiScribe: true,
      escalationPolicy: true,
      patientPortal: true,
      // Batch B
      syndromicSurveillance: true,
      screeningCamp: true,
      pictogramRx: true,
      referralSlips: true,
      // Batch C
      livingDemo: true,
      thermalTokenSlip: true,
      offlinePwa: true,
      firstRunSetup: !settings.configured,

      // ---- authenticated-only diagnostics ----
      // Whether a metered model key is wired up: an attacker who knows this can
      // target /api/summarize to spend the operator's money.
      ...(isStaff ? { llm: Boolean(process.env.OPENAI_API_KEY) } : {}),
      // Whether PHI is encrypted at rest, and how sessions/records are stored.
      ...(isStaff
        ? {
            phiEncrypted: process.env.MEDIKIOSK_ENCRYPT_PHI === "1",
            hostCookie: process.env.MEDIKIOSK_HOST_COOKIE_PREFIX === "1",
            persistence: "server-file",
            auth: "revocable-sessions",
          }
        : {}),
    },
  });
}
