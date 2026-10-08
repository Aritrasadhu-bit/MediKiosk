/**
 * CSRF defence-in-depth: verify the Origin/Referer of state-changing browser
 * requests matches this server. Requests with NO Origin/Referer (curl, node
 * scripts, kiosk tooling without a browser) are allowed — this protects
 * against browser-based cross-site requests without breaking API clients.
 * SameSite=Lax cookies already block the common cases; this is the belt.
 */

/**
 * Normalise a URL to its origin with the default port made explicit, so
 * "https://h", "https://h:443" and "https://h/" all compare equal while
 * "https://h:8443" and "http://h" do not.
 */
function normalisedOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`;
}

/** Origin of the server that received the request, from its own headers. */
function requestOrigin(headers: Headers): string | null {
  // Forwarded headers are client-supplied unless a proxy we control sets them,
  // so they are honoured only under the same MEDIKIOSK_TRUST_PROXY=1 opt-in
  // that clientIp() uses in rateLimit.ts. Trusting X-Forwarded-Host
  // unconditionally would let a client choose the "expected" origin it is
  // compared against, which is the one comparison this whole file exists for.
  const trustProxy = process.env.MEDIKIOSK_TRUST_PROXY === "1";
  const host = (trustProxy && headers.get("x-forwarded-host")) || headers.get("host");
  if (!host) return null;
  // Behind a TLS-terminating proxy the socket protocol is http but the browser
  // was told https, so X-Forwarded-Proto wins when present.
  const proto = (trustProxy && headers.get("x-forwarded-proto")) || "http";
  return normalisedOrigin(`${proto}://${host}`);
}

/**
 * Operator-declared public origins (comma-separated), e.g. the tunnel or
 * reverse-proxy URL visitors actually use:
 *   MEDIKIOSK_PUBLIC_ORIGIN=https://kiosk.hospital.example
 *
 * A tunneled/proxied deployment serves the app on an origin the server can
 * never derive from its own Host header (it sees localhost or http while the
 * browser sees https://public-name). Without an explicit allowlist every
 * browser POST fails the check below — the page renders fine but login,
 * lookups, submissions and check-ins all 403. Listing the origin explicitly
 * is secure (operator-configured, never client-supplied) unlike trusting
 * X-Forwarded-Host from an untrusted proxy.
 */
function trustedPublicOrigins(): Set<string> {
  const out = new Set<string>();
  for (const raw of (process.env.MEDIKIOSK_PUBLIC_ORIGIN ?? "").split(",")) {
    const norm = normalisedOrigin(raw.trim());
    if (norm) out.add(norm);
  }
  return out;
}

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  let source = origin;
  if (!source && referer) {
    const parsed = normalisedOrigin(referer);
    if (!parsed) return false; // malformed Referer — reject rather than trust it
    source = parsed;
  }
  if (!source) return true; // not a browser request — nothing to forge against

  const expected = requestOrigin(req.headers);
  if (!expected) return true; // no Host to compare against; nothing to forge

  const actual = normalisedOrigin(source);
  if (!actual) return false; // malformed Origin — reject

  if (actual === expected) return true;
  // Tunneled/proxied deployment: accept an operator-declared public origin.
  return trustedPublicOrigins().has(actual);
}

export function csrfGuard(req: Request): { ok: boolean; error?: string } {
  if (sameOrigin(req)) return { ok: true };
  return {
    ok: false,
    error: "Cross-site request rejected (Origin check failed).",
  };
}
