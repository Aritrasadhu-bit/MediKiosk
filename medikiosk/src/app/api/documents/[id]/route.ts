import { NextResponse } from "next/server";
import { getUpload } from "@/lib/server/db";
import { rateLimit, routeRateLimitKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Serve a stored scan. Streamed bytes; no JSON wrapping. */
export async function GET(req: Request, ctx: Ctx) {
  // Unauthenticated by design (unguessable capability URL), but each hit
  // streams megabytes — an unbounded poller could burn bandwidth for free.
  if (!rateLimit(routeRateLimitKey(req), 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }
  const { id } = await ctx.params;
  const upload = await getUpload(id);
  if (!upload) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(upload.data), {
    status: 200,
    headers: {
      "Content-Type": upload.mime,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}