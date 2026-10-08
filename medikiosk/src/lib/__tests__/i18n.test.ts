import { describe, expect, it } from "vitest";
import {
  UI,
  LANG_NAMES,
  t,
  CONSENT_TEXT,
  ct,
  welcomeSpeech,
  tokenCalledSpeech,
  tokenIssuedSpeech,
} from "@/lib/i18n";
import { CONSENT_SCOPES } from "@/lib/types";

describe("i18n dictionary", () => {
  it("covers all 10 languages", () => {
    expect(LANG_NAMES).toHaveLength(10);
  });

  it("every language has the same key set as English", () => {
    const enKeys = Object.keys(UI.en).sort();
    for (const lang of LANG_NAMES) {
      expect(Object.keys(UI[lang]).sort(), `key mismatch for ${lang}`).toEqual(enKeys);
    }
  });

  it("no empty or placeholder values", () => {
    for (const lang of LANG_NAMES) {
      for (const [k, v] of Object.entries(UI[lang])) {
        expect(v.trim().length, `${lang}.${k} is empty`).toBeGreaterThan(0);
        expect(v, `${lang}.${k} looks like a TODO`).not.toMatch(/TODO|TBD|placeholder/i);
      }
    }
  });
});

describe("t()", () => {
  it("returns the localized value", () => {
    expect(t("start", "hi")).toBe("शुरू करें");
    expect(t("start", "bn")).toBe("শুরু করুন");
    expect(t("tokenNumber", "ta")).toBe("உங்கள் டோக்கன் எண்");
  });

  it("falls back to English for unknown language", () => {
    expect(t("start", "fr")).toBe("Start");
  });

  it("falls back to English when no language given", () => {
    expect(t("welcome", undefined)).toBe("Welcome to MediKiosk");
  });

  it("returns the key itself if completely unknown", () => {
    expect(t("no_such_key", "en")).toBe("no_such_key");
  });
});

describe("welcomeSpeech", () => {
  it("provides a greeting for every supported language", () => {
    for (const lang of LANG_NAMES) {
      expect(welcomeSpeech(lang).length, lang).toBeGreaterThan(10);
    }
  });
  it("defaults to English", () => {
    expect(welcomeSpeech("xx")).toContain("Welcome");
  });
});

describe("tokenIssuedSpeech / tokenCalledSpeech", () => {
  it("speaks the token number in every supported language", () => {
    for (const lang of LANG_NAMES) {
      const issued = tokenIssuedSpeech({ lang, token: "A 042" });
      const called = tokenCalledSpeech({ lang, token: "A 042" });
      expect(issued, lang).toContain("A 042");
      expect(called, lang).toContain("A 042");
    }
  });

  it("is not the same script as English for any non-English language", () => {
    // Guards against a copy-paste of the English string into a locale branch.
    const en = tokenIssuedSpeech({ lang: "en", token: "7" });
    for (const lang of LANG_NAMES.filter((l) => l !== "en")) {
      expect(tokenIssuedSpeech({ lang, token: "7" }), lang).not.toBe(en);
    }
  });

  it("addresses the patient by name when one is known", () => {
    expect(tokenCalledSpeech({ lang: "hi", name: "राम", token: "9" })).toContain("राम");
    expect(tokenCalledSpeech({ lang: "en", token: "9" })).not.toContain("undefined");
  });

  it("falls back to English for an unknown language", () => {
    expect(tokenIssuedSpeech({ lang: "fr", token: "7" })).toContain("Your number is 7");
    expect(tokenCalledSpeech({ lang: undefined, token: "7" })).toContain("your turn");
  });
});

describe("consent text (ct)", () => {
  it("covers every language with the same key set as English", () => {
    const enKeys = Object.keys(CONSENT_TEXT.en).sort();
    expect(enKeys.length).toBeGreaterThan(0);
    for (const lang of LANG_NAMES) {
      expect(Object.keys(CONSENT_TEXT[lang] ?? {}).sort(), `key mismatch for ${lang}`).toEqual(enKeys);
    }
  });

  it("labels every enforced scope in every language", () => {
    // A scope without a purpose_<scope> label cannot be consented to — the
    // identify page also throws on this at module load; the test pins it here.
    for (const lang of LANG_NAMES) {
      for (const scope of CONSENT_SCOPES) {
        const label = CONSENT_TEXT[lang]?.[`purpose_${scope}`] ?? "";
        expect(label.trim().length, `${lang}.purpose_${scope} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("has no empty or placeholder consent strings", () => {
    for (const lang of LANG_NAMES) {
      for (const [k, v] of Object.entries(CONSENT_TEXT[lang])) {
        expect(v.trim().length, `${lang}.${k} is empty`).toBeGreaterThan(0);
        expect(v, `${lang}.${k} looks like a TODO`).not.toMatch(/TODO|TBD|placeholder|lorem/i);
      }
    }
  });

  it("is actually translated, not English copied into every locale", () => {
    for (const lang of LANG_NAMES.filter((l) => l !== "en")) {
      expect(CONSENT_TEXT[lang].consentMain, lang).not.toBe(CONSENT_TEXT.en.consentMain);
    }
  });

  it("falls back to English for unknown languages", () => {
    expect(ct("consentTitle", "fr")).toBe(CONSENT_TEXT.en.consentTitle);
    expect(ct("consentTitle", undefined)).toBe(CONSENT_TEXT.en.consentTitle);
    expect(ct("consentTitle", "ta")).toBe(CONSENT_TEXT.ta.consentTitle);
  });
});