/* MediKiosk Service Worker — offline-first for kiosk resilience (Batch C, P6) */
const CACHE = "medikiosk-v4";
const OFFLINE_PAGE = "/offline.html";
// Intake shell routes are precached so a dropped network mid-flow still
// renders the app shell (form state lives in localStorage/outbox).
const PRECACHE = ["/", "/identify", "/history", "/scan", "/summary", "/done", "/camp", "/display", "/manifest.webmanifest", OFFLINE_PAGE];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;

  // API calls: network-first with cache fallback
  if (request.url.includes("/api/")) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(JSON.stringify({ ok: false, error: "Network unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        })
    );
    return;
  }

  // Navigation: network-first (new deploys win), then a cached copy of the
  // same route (works offline mid-flow), then the offline page, then "/".
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_PAGE);
          if (offline) return offline;
          const root = await caches.match("/");
          if (root) return root;
          return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        })
    );
    return;
  }

  // Static assets + fonts + images: stale-while-revalidate, including
  // cross-origin font files so offline reloads keep brand type and icons.
  const isFontOrImage =
    request.destination === "font" ||
    request.destination === "image" ||
    /\.(woff2?|ttf|otf|png|jpg|jpeg|svg|ico)$/.test(new URL(request.url).pathname);

  // Static assets: stale-while-revalidate.
  //
  // Was cache-first, which meant a deploy could never reach an already-visited
  // kiosk: the old asset was served from Cache Storage forever. Anything whose
  // URL is not content-hashed (Turbopack dev chunks, files in public/) makes
  // this permanent. Serving the cached copy immediately keeps the kiosk
  // responsive, while the background refetch means the *next* load is correct.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          // Opaque cross-origin font/image responses have status 0 (never
          // `ok`) but are still cacheable — include them explicitly.
          if ((res.ok || res.type === "opaque") && (request.url.includes("/_next/") || request.url.includes("/static") || isFontOrImage)) {
            cache.put(request, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => undefined);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const netRes = await network;
      if (netRes) return netRes;
      // Cross-origin font/image with no cache: return empty, never the app shell.
      if (isFontOrImage && !request.url.startsWith(self.location.origin)) {
        return new Response("", { status: 404 });
      }
      return new Response("", { status: 404 });
    })
  );
});