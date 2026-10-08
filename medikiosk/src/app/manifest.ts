import type { MetadataRoute } from "next";

/**
 * Web App Manifest (Batch C, P6) — serves /manifest.webmanifest, which the
 * root layout already points at. Enables installability and the standalone
 * kiosk experience; the PWA bootstrap registers the service worker.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MediKiosk — AI Clinical History Platform",
    short_name: "MediKiosk",
    description:
      "AI-powered patient case-taking kiosk for SIH26047: conversational multilingual history, medical document digitization, ABDM integration, and OPD queue management.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#ffffff",
    categories: ["health", "medical", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}