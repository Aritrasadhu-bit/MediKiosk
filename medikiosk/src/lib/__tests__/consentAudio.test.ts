import { describe, expect, it } from "vitest";
import { consentAudioScript } from "@/lib/speech";

/**
 * Spoken consent scripts.
 *
 * A low-literacy patient cannot read the consent panel, so the audio script
 * IS the consent disclosure — it must speak their language, never fall silent,
 * and always state the three facts (record + ABHA link + share; revocable).
 */

const UI_LANGS = ["hi", "en", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa"];

describe("consentAudioScript", () => {
  it("covers every kiosk UI language with all three lines", () => {
    for (const lang of UI_LANGS) {
      const s = consentAudioScript(lang);
      expect(s.patient.length, lang).toBeGreaterThan(20);
      expect(s.guardian.length, lang).toBeGreaterThan(20);
      expect(s.thanks.length, lang).toBeGreaterThan(5);
    }
  });

  it("states revocability in every language", () => {
    // The withdrawal right is the load-bearing sentence — each script must
    // carry a revocation marker, not just the grant.
    const markers: Record<string, string[]> = {
      hi: ["वापस"],
      en: ["withdraw"],
      bn: ["প্রত্যাহার"],
      ta: ["திரும்ப"],
      te: ["ఉపసంహర"],
      mr: ["मागे"],
      gu: ["પાછી"],
      kn: ["ಹಿಂಪಡೆಯ"],
      ml: ["പിൻവലി"],
      pa: ["ਵਾਪਸ"],
    };
    for (const lang of UI_LANGS) {
      const s = consentAudioScript(lang);
      const text = `${s.patient} ${s.guardian}`;
      expect(
        markers[lang].some((m) => text.includes(m)),
        `${lang} script must state revocability`
      ).toBe(true);
    }
  });

  it("falls back through region code to Hindi to English, never silence", () => {
    expect(consentAudioScript("hi-IN").thanks).toBe(consentAudioScript("hi").thanks);
    expect(consentAudioScript("xx").patient).toBe(consentAudioScript("hi").patient);
    expect(consentAudioScript("").patient.length).toBeGreaterThan(0);
  });
});
