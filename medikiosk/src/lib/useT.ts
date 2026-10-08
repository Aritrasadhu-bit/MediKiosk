"use client";

import { useSession } from "@/lib/useSession";
import { t, ct } from "@/lib/i18n";

/**
 * Bound translators for the kiosk's chosen language.
 *
 * Every patient-facing screen must render through these (never bare `t(key)`
 * which silently falls back to English): after the patient picks a language
 * on the welcome screen, the whole kiosk UI follows it, falling back to
 * English per-key for any language that lacks a curated string.
 */
export function useT() {
  const { session } = useSession();
  const lang = session.language?.code ?? "en";
  return {
    lang,
    t: (key: string) => t(key, lang),
    ct: (key: string) => ct(key, lang),
  };
}
