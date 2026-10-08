import { NextResponse } from "next/server";
import { assembleSummary, buildTemplateSummary, type SummaryInput } from "@/lib/summarizer";
import { summarizeRequestSchema, safeParse } from "@/lib/validation";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { csrfGuard } from "@/lib/server/csrf";
import { completeText, llmAvailable } from "@/lib/server/llm";
import { getEncounter } from "@/lib/server/db";
import { canUseExternalModel } from "@/lib/consent";
import type { ConsentState } from "@/lib/types";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

const SYSTEM = `
You are a senior physician's clinical assistant for Indian hospitals. Synthesize a concise, structured, physician-ready clinical history summary in standard format:
CHIEF COMPLAINT → HPI → PAST MEDICAL/SURGICAL → DRUG & ALLERGY → FAMILY → PERSONAL → (MENSTRUAL/OBSTETRIC if female patient) → REVIEW OF SYSTEMS → PRIOR INVESTIGATIONS SUMMARY → AYUSH ASSESSMENT (if present) → RED FLAGS.
Rules:
- Write the entire summary in English. The physician readout is always English, even if the patient's own words below are in another language.
- Never invent facts. Only include what is provided. Mark missing as "Not documented".
- Keep it scannable with bullet points.
- Flag abnormal values and potential drug interactions explicitly.
- This is a draft for physician confirmation, not a diagnosis.
`;

export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  // The LLM path spends the hospital's model budget per call, so a cross-site
  // page must not be able to drive it through a visitor's browser.
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  // `history`/`documents` are open records, so the schema cannot bound the body
  // on its own. Reject on the declared length before JSON.parse allocates.
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > 4 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = safeParse(summarizeRequestSchema, body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    const { consent, encounterId, ...rest } = parsed.data;
    const input = { ...rest } as unknown as SummaryInput;

    // Deterministic rules engine is the default and fully offline. The LLM path
    // is an opt-in enhancement, and the response says which one produced the
    // text so a physician never mistakes one for the other.
    const deterministic = buildTemplateSummary(input);

    // External AI processing is a distinct purpose and needs the patient's
    // explicit `ai_processing` scope. Two sources, in order of trust:
    //   1. `encounterId` — the consent is read back from the stored record, so
    //      a staff client cannot widen it by editing the request body.
    //   2. The kiosk's own consent payload for the first, pre-save summary.
    // Anything missing, revoked, or expired keeps us offline.
    let consentForAi: ConsentState | undefined = consent as ConsentState | undefined;
    if (encounterId) {
      const stored = await getEncounter(encounterId);
      consentForAi = stored?.consent;
      if (!stored) {
        return NextResponse.json({ ok: false, error: "Encounter not found." }, { status: 404 });
      }
    }

    if (!canUseExternalModel(consentForAi)) {
      // Not an error: declining external processing is a normal outcome and the
      // summary is still produced, entirely locally.
      return NextResponse.json({ ok: true, summary: deterministic, source: "rules-engine" });
    }

    if (!llmAvailable()) {
      return NextResponse.json({ ok: true, summary: deterministic, source: "rules-engine" });
    }

    const drafted = await completeText(SYSTEM, input);
    if (!drafted) {
      return NextResponse.json({ ok: true, summary: deterministic, source: "rules-engine" });
    }

    log("info", "summarize", "external AI used with patient consent", {
      encounterId: encounterId ?? null,
      source: "llm",
    });

    // The model's narrative is prepended to the deterministic structured
    // record rather than replacing it, and the footer states the provenance.
    return NextResponse.json({
      ok: true,
      summary: assembleSummary(input, true, drafted),
      source: "llm",
    });
  } catch (err) {
    log("error", "summarize", "summary generation failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: "Summary generation failed." }, { status: 500 });
  }
}
