import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/server/db";
import { documentUploadSchema, safeParse } from "@/lib/validation";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";
import { csrfGuard } from "@/lib/server/csrf";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";

/**
 * Public (kiosk) scan-image upload. The kiosk downscales to JPEG/WebP before
 * sending; the server stores the file under data/uploads/ and returns a URL the
 * physician dashboard can open. Ids are unguessable UUIDs (PHI is not exposed
 * via the public route beyond that).
 */
export async function POST(req: Request) {
  // This writes a file to disk, so it is state-changing and belongs under the
  // same CSRF policy as every other mutating route. (It was the one mutating
  // POST missing the guard.) The kiosk is same-origin so a browser sends a
  // matching Origin, and non-browser clients are exempt by design.
  const csrf = csrfGuard(req);
  if (!csrf.ok) return NextResponse.json({ ok: false, error: csrf.error }, { status: 403 });

  if (!rateLimit(routeRateLimitKey(req), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  // Reject oversized bodies before JSON.parse allocates: dataBase64 accepts up
  // to 20M chars, which is ~27MB of JSON parsed and written 20x/min.
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > 24 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = safeParse(documentUploadSchema, body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const saved = await saveUpload(parsed.data.dataBase64, parsed.data.filename, parsed.data.mime);
  if (!saved) {
    return NextResponse.json({ ok: false, error: "Upload rejected (size/format)." }, { status: 400 });
  }
  log("info", "documents", "scan uploaded", { id: saved.id, filename: saved.filename, bytes: saved.bytes });
  return NextResponse.json({ ok: true, document: saved });
}