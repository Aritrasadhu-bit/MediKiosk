import { NextResponse } from "next/server";
import { asrRequestSchema, safeParse } from "@/lib/validation";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { csrfGuard } from "@/lib/server/csrf";
import { canUseExternalModel } from "@/lib/consent";
import { selectAsrBackend } from "@/lib/server/asrBackend";

export const runtime = "nodejs";

async function ai4bharatTranscribe(buffer: Buffer, mime: string, language: string): Promise<string> {
  const url = process.env.AI4BHARAT_ASR_URL;
  if (!url) throw new Error("AI4BHARAT_ASR_URL not configured");
  const form = new FormData();
  const ext = mime.includes("wav") ? "wav" : "webm";
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), `audio.${ext}`);
  form.append("languageId", language);
  // A hung ASR backend must fail fast so the kiosk falls back to the client
  // Web Speech API instead of hanging mid-intake.
  const res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`AI4Bharat ASR failed: ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  return (typeof json?.transcript === "string" && json.transcript) || String(json?.text ?? "");
}

async function bhashiniTranscribe(buffer: Buffer, mime: string, language: string): Promise<string> {
  const { BHASHINI_API_KEY, BHASHINI_PIPELINE_ID } = process.env;
  if (!BHASHINI_API_KEY || !BHASHINI_PIPELINE_ID) throw new Error("BHASHINI_* not configured");
  const auth = await fetch("https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/get-compute-inference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // A hung ASR backend must fail fast so the kiosk falls back instead of
    // hanging mid-intake.
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      modelId: process.env.BHASHINI_ASR_MODEL_ID || "ai4bharat/whisper-large-v3",
      task: "asr",
      language: language.replace("-", "_"),
      audioContent: buffer.toString("base64"),
    }),
  });
  if (!auth.ok) throw new Error(`Bhashini ASR failed: ${auth.status}`);
  const json = (await auth.json()) as Record<string, unknown>;
  const output = (json?.output ?? {}) as Record<string, unknown>;
  return String(output?.text ?? json?.transcript ?? "");
}

export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 15, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  // Transcription calls a metered backend per request — a cross-site page must
  // not drive it through a visitor's browser.
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  // audioBase64 accepts up to 20M chars, which is ~27MB once the JSON envelope
  // is parsed. Reject on the declared length first so an oversized body is never
  // materialised by JSON.parse.
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > 24 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = safeParse(asrRequestSchema, body);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    // Voice audio goes to an external transcription backend — same
    // ai_processing rule as every other external-AI path. Without the scope
    // the kiosk falls back to the on-device Web Speech API.
    if (!canUseExternalModel(parsed.data.consent)) {
      return NextResponse.json(
        { ok: false, error: "Server transcription needs the patient's AI-processing consent. Use on-device speech instead." },
        { status: 403 }
      );
    }
    const buffer = Buffer.from(parsed.data.audioBase64, "base64");
    const mime = parsed.data.mime || "audio/wav";
    const lang = parsed.data.language || "hi-IN";

    const backend = selectAsrBackend(process.env);
    if (backend.kind === "misconfigured") {
      return NextResponse.json(
        { ok: false, error: backend.error, hint: "See .env.example" },
        { status: 501 }
      );
    }

    if (backend.kind === "ai4bharat") {
      const transcript = await ai4bharatTranscribe(buffer, mime, lang);
      return NextResponse.json({ ok: !!transcript, transcript });
    }

    if (backend.kind === "bhashini") {
      const transcript = await bhashiniTranscribe(buffer, mime, lang);
      return NextResponse.json({ ok: !!transcript, transcript });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "No Indian ASR backend configured. Set AI4BHARAT_ASR_URL or BHASHINI_API_KEY OR rely on the client Web Speech API.",
        hint: "See .env.example",
      },
      { status: 501 }
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Transcription failed." }, { status: 500 });
  }
}