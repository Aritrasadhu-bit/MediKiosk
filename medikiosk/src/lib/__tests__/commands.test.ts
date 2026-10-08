import { describe, expect, it } from "vitest";
import { matchCommand, normalizeCommandText, VOICE_COMMAND_HINT } from "@/lib/commands";

describe("normalizeCommandText", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeCommandText("  Next!! ")).toBe("next");
    expect(normalizeCommandText("आगे बढ़ो!")).toBe("आगे बढ़ो");
  });
  it("collapses whitespace", () => {
    expect(normalizeCommandText("aage   badho")).toBe("aage badho");
  });
});

describe("matchCommand", () => {
  it("matches English commands", () => {
    expect(matchCommand("Next")).toBe("next");
    expect(matchCommand("please continue")).toBe("next");
    expect(matchCommand("back")).toBe("back");
    expect(matchCommand("skip this one")).toBe("skip");
    expect(matchCommand("I need help")).toBe("help");
    expect(matchCommand("go to main menu")).toBe("menu");
    expect(matchCommand("print the prescription")).toBe("print");
  });

  it("matches Hindi / romanised Hindi commands", () => {
    expect(matchCommand("आगे")).toBe("next");
    expect(matchCommand("आगे बढ़ो")).toBe("next");
    expect(matchCommand("अगला")).toBe("next");
    expect(matchCommand("aage badho")).toBe("next");
    expect(matchCommand("वापस")).toBe("back");
    expect(matchCommand("peeche")).toBe("back");
    expect(matchCommand("मदद")).toBe("help");
    expect(matchCommand("madad karo")).toBe("help");
    expect(matchCommand("छोड़ो")).toBe("skip");
    expect(matchCommand("घर")).toBe("menu");
    expect(matchCommand("प्रिंट")).toBe("print");
  });

  it("does not match unrelated speech", () => {
    expect(matchCommand("my chest hurts a lot")).toBeNull();
    expect(matchCommand("")).toBeNull();
    expect(matchCommand("!!!")).toBeNull();
  });

  it("matches commands in all 10 languages", () => {
    // Bengali
    expect(matchCommand("পরের ধাপ")).toBe("next");
    expect(matchCommand("পেছনে")).toBe("back");
    expect(matchCommand("সাহায্য করুন")).toBe("help");
    // Tamil
    expect(matchCommand("அடுத்தது")).toBe("next");
    expect(matchCommand("திரும்பு")).toBe("back");
    expect(matchCommand("உதவி")).toBe("help");
    // Telugu
    expect(matchCommand("తర్వాత")).toBe("next");
    expect(matchCommand("వెనుకకు")).toBe("back");
    expect(matchCommand("సహాయం కావాలి")).toBe("help");
    // Marathi
    expect(matchCommand("पुढे जा")).toBe("next");
    expect(matchCommand("मागे")).toBe("back");
    expect(matchCommand("मदत हवी")).toBe("help");
    // Gujarati
    expect(matchCommand("આગળ વધો")).toBe("next");
    expect(matchCommand("પાછળ")).toBe("back");
    expect(matchCommand("મદદ કરો")).toBe("help");
    // Kannada
    expect(matchCommand("ಮುಂದುವರಿ")).toBe("next");
    expect(matchCommand("ಹಿಂದೆ")).toBe("back");
    expect(matchCommand("ಸಹಾಯ ಬೇಕು")).toBe("help");
    // Malayalam
    expect(matchCommand("അടുത്തത്")).toBe("next");
    expect(matchCommand("തിരികെ")).toBe("back");
    expect(matchCommand("സഹായം വേണം")).toBe("help");
    // Punjabi
    expect(matchCommand("ਅੱਗੇ ਵਧੋ")).toBe("next");
    expect(matchCommand("ਪਿੱਛੇ")).toBe("back");
    expect(matchCommand("ਮਦਦ ਚਾਹੀਦੀ ਹੈ")).toBe("help");
    // print in a non-Hindi script
    expect(matchCommand("പ്രിന്റ്")).toBe("print");
    expect(matchCommand("प्रिंट")).toBe("print");
  });

  it("exposes a hint for the UI", () => {
    expect(VOICE_COMMAND_HINT).toContain("Next");
  });
});