import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone server build (self-contained `server.js`) so the Docker image
  // only ships runtime code + static assets. See Dockerfile.
  output: "standalone",
  // Dev-server cross-origin protection: `next dev` blocks requests for dev-only
  // assets and endpoints (notably /_next/hmr) from any origin other than the
  // one the server was initialised with (localhost). Browsers reaching the dev
  // server through a tunnel are cross-origin, so the HMR client gets a 403, the
  // page never hydrates, and every button silently does nothing while the
  // server-rendered HTML still looks fine.
  //
  // Hostnames only — no scheme, no port. `*.example.dev` wildcards are supported,
  // which keeps working when a tunnel hands out a new random subdomain.
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.ngrok.app",
    "*.loca.lt",
  ],
  // pdfjs-dist ships a ~6MB worker; import it via `?url` in the scan page.
  serverExternalPackages: ["pdfjs-dist"],
  // --------------------------------------------------- security headers (Point 16)
  // Pragmatic CSP: `'unsafe-inline'`/`'unsafe-eval'` are required by Next.js
  // hydration scripts, and the CDN origins by tesseract.js (OCR) which is
  // shipped from jsDelivr + Project Naptha's tessdata. The tighter cross-site
  // protections (frame, object-src, base-uri, form-action, COOP, nosniff)
  // still apply in full.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com",
      "worker-src 'self' blob: https://cdn.jsdelivr.net",
      "media-src 'self' blob:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
