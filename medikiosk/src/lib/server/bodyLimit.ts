import "server-only";

import { NextResponse } from "next/server";

/**
 * Pre-parse request-size guard.
 *
 * Every JSON route validates shape with zod, but `req.json()` materialises
 * the whole body BEFORE validation runs — so schema `.max()`s alone cannot
 * stop a client from making the server allocate hundreds of megabytes per
 * request. Comparing the declared Content-Length first rejects the trivial
 * flood without parsing anything.
 *
 * Known residual: chunked requests carry no Content-Length (treated as 0
 * here). That path is bounded instead by per-route zod `.max()`s on stored
 * fields plus the per-IP rate limits on every route, which cap how many
 * concurrent giants one client can hold open.
 */
export function bodyTooLarge(req: Request, maxBytes: number): boolean {
  return Number(req.headers.get("content-length") ?? 0) > maxBytes;
}

/** 413 response matching the message used across routes. */
export function payloadTooLarge() {
  return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
}
