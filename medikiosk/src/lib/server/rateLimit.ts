import "server-only";

/**
 * Minimal in-memory sliding-window rate limiter for public endpoints
 * (OCR, ASR). Good enough for the demo; swap for Redis in production.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  // Opportunistic cleanup
  if (buckets.size > 500) {
    for (const [k, b] of buckets) {
      b.hits = b.hits.filter((t) => now - t < windowMs);
      if (b.hits.length === 0) buckets.delete(k);
    }
  }
  return true;
}

export function clientIp(req: Request): string {
  // Trust forwarded headers ONLY when explicitly configured — a directly
  // reachable server must not let clients spoof X-Forwarded-For to dodge a
  // rate limit. Behind a reverse proxy that sanitizes these headers, set
  // MEDIKIOSK_TRUST_PROXY=1 to get per-client buckets again.
  const trustProxy = process.env.MEDIKIOSK_TRUST_PROXY === "1";
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip");
  return trustProxy ? forwarded || realIp || "local" : "local";
}

/**
 * Rate-limit bucket key namespaced per route+method+IP so a burst on one
 * endpoint (e.g. OCR) can never exhaust the budget of another (e.g. login).
 */
export function routeRateLimitKey(req: Request): string {
  let path = "unknown";
  try {
    path = new URL(req.url).pathname;
  } catch {
    /* malformed URL — fall back to unknown */
  }
  return `${req.method} ${path} | ${clientIp(req)}`;
}