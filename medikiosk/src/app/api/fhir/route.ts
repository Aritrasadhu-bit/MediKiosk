import { NextResponse } from "next/server";
import { toFhirBundle } from "@/lib/fhirBundle";
import { fhirRequestSchema, safeParse } from "@/lib/validation";
import { currentUser } from "@/lib/server/auth";
import { csrfGuard } from "@/lib/server/csrf";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import type { StoredHistory } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }
  if (!rateLimit(routeRateLimitKey(req), 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  // `fhirRequestSchema` is an open record, so the schema cannot bound the body
  // on its own. Reject on the declared length before JSON.parse allocates.
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > 4 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = safeParse(fhirRequestSchema, body);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    if (!(parsed.data as Partial<StoredHistory>)?.history) {
      return NextResponse.json({ ok: false, error: "history required" }, { status: 400 });
    }
    const bundle = toFhirBundle(parsed.data as unknown as StoredHistory);
    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/fhir+json" },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "FHIR export failed." }, { status: 500 });
  }
}