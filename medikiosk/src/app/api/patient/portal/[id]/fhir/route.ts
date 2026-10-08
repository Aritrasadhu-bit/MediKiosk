import { NextResponse } from "next/server";
import { getEncounter } from "@/lib/server/db";
import { validPortalCode } from "@/lib/server/portal";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { toFhirBundle } from "@/lib/fhirBundle";

export const runtime = "nodejs";

const CACHE_MAX_AGE = 60 * 5;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Public patient portal: download their OWN encounter as a FHIR R4 bundle
 * (interoperable with ABDM/HIP ecosystems) — code-gated like every portal call.
 */
export async function GET(req: Request, ctx: Ctx) {
  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
  }
  const { id } = await ctx.params;
  const code = new URL(req.url).searchParams.get("code");
  if (!validPortalCode(id, code)) {
    return NextResponse.json({ ok: false, error: "Invalid portal access code." }, { status: 403 });
  }
  const enc = await getEncounter(id);
  if (!enc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const bundle = toFhirBundle(enc);
  return NextResponse.json(bundle, {
    headers: {
      "Content-Type": "application/fhir+json; charset=utf-8",
      "Content-Disposition": `attachment; filename="medikiosk-${enc.encounterId.slice(0, 8)}.fhir.json"`,
      "Cache-Control": `private, max-age=${CACHE_MAX_AGE}`,
    },
  });
}