import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono, Noto_Sans_Devanagari, Noto_Sans_Gurmukhi } from "next/font/google";
import "./globals.css";
import PwaBootstrap from "@/components/PwaBootstrap";
import KioskHeartbeat from "@/components/KioskHeartbeat";
import SessionWatchdog from "@/components/SessionWatchdog";
import A11yToggle from "@/components/A11yToggle";
import LangSync from "@/components/LangSync";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-stack",
});

// Hindi is a primary interface language here, and Inter carries no
// Devanagari glyphs. Without an explicit face the browser silently falls
// back mid-word, so the Devanagari range is declared explicitly.
const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  display: "swap",
  variable: "--font-deva-stack",
  weight: ["400", "500", "600", "700"],
});

// Punjabi (Gurmukhi) is a first-class kiosk language. Gurmukhi lives in its
// own Unicode block (U+0A00–U+0A7F) which Devanagari faces do NOT cover —
// without this, pa text falls back to whatever the kiosk happens to have
// (tofu boxes on lean kiosk images) instead of rendering reliably.
const notoGurmukhi = Noto_Sans_Gurmukhi({
  subsets: ["gurmukhi"],
  display: "swap",
  variable: "--font-guru-stack",
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-mono-stack",
});

export const metadata: Metadata = {
  title: {
    default: "MediKiosk · District Hospital OPD",
    template: "%s · MediKiosk",
  },
  description:
    "Unattended outpatient intake kiosk. Patients register, describe symptoms in their own language, and upload medical documents; clinical staff review the structured record in the physician portal.",
  applicationName: "MediKiosk",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "MediKiosk" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${notoDevanagari.variable} ${notoGurmukhi.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
        <LangSync />
        <PwaBootstrap />
        <KioskHeartbeat />
        <SessionWatchdog />
        <A11yToggle />
      </body>
    </html>
  );
}
