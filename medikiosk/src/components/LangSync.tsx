"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/useSession";

/**
 * Syncs <html lang> with the kiosk's chosen language so screen readers
 * pronounce Devanagari/Gurmukhi/Tamil/etc. correctly instead of applying
 * English pronunciation rules to every screen.
 */
export default function LangSync() {
  const { session } = useSession();
  useEffect(() => {
    try {
      document.documentElement.lang = session.language?.code ?? "en";
    } catch {
      /* ignore */
    }
  }, [session.language?.code]);
  return null;
}
