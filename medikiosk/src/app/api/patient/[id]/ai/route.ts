import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { getEncounterForStaff, getEncounterForStaffOrBreakGlass, recordAuditServer } from "@/lib/server/db";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { buildFallbackAiPanel, suggestedDifferentials, stdSuggestedQuestions, type AiPanel } from "@/lib/clinical";
import { llmJson } from "@/lib/server/llm";
import { canUseExternalModel } from "@/lib/consent";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type LlmPanel = { differentials?: string[]; suggestedQuestions?: string[] };

/**
 * AI thought-partner panel for a patient record: possible differentials and
 * the history gaps the doctor should clarify. Rule-based by default; upgraded
 * to the LLM when OPENAI_API_KEY is configured.
 */
export async function GET(req: Request, ctx: Ctx) {
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  const { id } = await ctx.params;
  // Consent-aware read: a record whose clinical-care consent was revoked is
  // withheld here exactly as on every other staff surface — unless a live
  // break-glass activation covers it (resuscitation exception, audited).
  let enc = await getEncounterForStaff(id);
  if (!enc) {
    const emergency = await getEncounterForStaffOrBreakGlass(id);
    if (!emergency?.viaBreakGlass) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    enc = emergency.encounter;
    await recordAuditServer(
      id,
      "break_glass_override",
      `Emergency AI-panel read by ${user.username} (${user.role}) under active break-glass`,
      user.username
    );
  }

  let panel: AiPanel = buildFallbackAiPanel(enc);

  // The LLM upgrade sends record text to an external provider, which needs
  // the patient's explicit `ai_processing` scope — same rule as /api/summarize.
  // Without it the deterministic rules panel is returned and nothing leaves
  // the hospital.
  if (!canUseExternalModel(enc.consent)) {
    return NextResponse.json({ ok: true, panel, source: "rules-engine" });
  }

  const llm = await llmJson<LlmPanel>(
    "You are a senior physician's decision-support assistant in an Indian hospital. " +
      `The patient is attending the "${enc.patient.department || "General Medicine"}" OPD department. ` +
      "Given the patient record, return strictly JSON: {\"differentials\":[3 possible diagnoses strictly tailored to this specialty as a string array],\"suggestedQuestions\":[up to 5 high-yield clarifying questions specifically relevant to this department that the doctor should ask the patient to resolve diagnostic ambiguity]}. " +
      "Base everything strictly on the record and the department focus; mark uncertainty rather than inventing.",
    {
      department: enc.patient.department,
      chiefComplaint: (enc.history as { chiefComplaint?: string })?.chiefComplaint ?? "",
      summary: enc.summary,
      redFlags: (enc.redFlags ?? []).map((f) => `${f.symptom}: ${f.message}`),
      vitals: enc.patient.vitals ?? {},
      age: enc.patient.age,
      sex: enc.patient.sex,
    }
  );
  if (llm?.differentials?.length || llm?.suggestedQuestions?.length) {
    panel = {
      hinted: true,
      differentials: llm.differentials?.length ? llm.differentials : suggestedDifferentials(enc),
      suggestedQuestions: llm.suggestedQuestions?.length ? llm.suggestedQuestions : stdSuggestedQuestions(enc),
    };
    return NextResponse.json({ ok: true, panel, source: "llm" });
  }

  return NextResponse.json({ ok: true, panel, source: "rules-engine" });
}