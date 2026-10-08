import { NextResponse } from "next/server";
import { heuristicExtract, parseDate, inferDocType, type ExtractedEntities } from "@/lib/extractor";
import { extractRequestSchema, safeParse } from "@/lib/validation";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { csrfGuard } from "@/lib/server/csrf";
import { canUseExternalModel } from "@/lib/consent";
import { bodyTooLarge, payloadTooLarge } from "@/lib/server/bodyLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!rateLimit(routeRateLimitKey(req), 40, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  // The LLM path spends the hospital's model budget per call, so a cross-site
  // page must not be able to drive it through a visitor's browser.
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  // OCR text accepts up to 200KB — bound the envelope above that.
  if (bodyTooLarge(req, 1024 * 1024)) return payloadTooLarge();
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = safeParse(extractRequestSchema, body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    const { text, filename } = parsed.data;

    // Rules engine first (offline and free).
    let entities = heuristicExtract(text, filename);

    // If OpenAI key available, use LLM for superior structuring — but only
    // with the patient's explicit ai_processing scope. The heuristic result
    // above stands regardless, so declining external processing loses nothing
    // except the structuring upgrade.
    const apiKey = process.env.OPENAI_API_KEY;
    const aiAllowed = canUseExternalModel(parsed.data.consent);
    if (apiKey && aiAllowed) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          // A hung provider must fall back to the heuristic engine, not wedge
          // the kiosk.
          signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS ?? 20_000)),
          body: JSON.stringify({
            model: "gpt-4o",
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content:
                  "You are a medical document digitization engine. Extract structured clinical entities from OCR text of Indian medical documents. Respond in strict JSON with keys: { diagnoses: string[], medications: [{name, dosage?, frequency?, duration?}], investigations: [{test, value, unit?, referenceRange?, flag?}], procedures: string[], date?: string }. flag is one of high|low|normal. Skip obviously spurious entries. Use plain English terms.",
              },
              { role: "user", content: text },
            ],
            response_format: { type: "json_object" },
          }),
        });
        const data = await res.json();
        const parsedLlm = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as Partial<ExtractedEntities["entities"]> & { date?: string };
        entities = {
          ...entities,
          ...(parsedLlm as object),
          type: inferDocType(filename, text),
          date: parsedLlm.date ?? parseDate(text),
        };
        const llmAbnormal = (parsedLlm.investigations ?? []).filter((i: ExtractedEntities["entities"]["investigations"][number]) => i.flag && i.flag !== "normal");
        entities.abnormalValues = llmAbnormal.length ? llmAbnormal : entities.abnormalValues;
      } catch {
        // fall back to heuristic
      }
    }

    return NextResponse.json({ ok: true, entities });
  } catch {
    return NextResponse.json({ ok: false, error: "Extraction failed internally." }, { status: 500 });
  }
}