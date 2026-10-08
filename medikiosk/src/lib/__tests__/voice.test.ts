import { describe, expect, it } from "vitest";
import { analyserPeak, appendVoiceText, joinFinals } from "@/lib/speech";
import { selectAsrBackend } from "@/lib/server/asrBackend";

/**
 * Voice input helpers.
 *
 * The level meter must map silence to ~0 and speech to a visible range
 * without ever exceeding 1; the backend selector must prefer explicit config
 * and fail loudly (not with a generic 500 after a wasted round-trip) on
 * half-configuration.
 */

describe("analyserPeak", () => {
  it("maps silence to zero", () => {
    expect(analyserPeak(new Float32Array(512))).toBe(0);
  });

  it("scales speech peaks into a visible range and clamps at one", () => {
    const speech = new Float32Array(512).fill(0.2);
    const level = analyserPeak(speech);
    expect(level).toBeGreaterThan(0.08);
    expect(level).toBeLessThanOrEqual(1);
    expect(analyserPeak(new Float32Array([5, -5]))).toBe(1);
  });
});

describe("joinFinals", () => {
  it("joins final segments once, in order", () => {
    expect(joinFinals(["I have fever", "and headache"])).toBe("I have fever and headache");
  });

  it("drops empty segments and normalizes whitespace", () => {
    expect(joinFinals(["  fever   ", "", null, undefined, " headache "])).toBe("fever headache");
  });

  it("returns empty for no usable segments", () => {
    expect(joinFinals([])).toBe("");
    expect(joinFinals([null, "  "])).toBe("");
  });
});

describe("appendVoiceText", () => {
  it("keeps the first transcript when the field is empty", () => {
    expect(appendVoiceText("", "I have fever and headache.")).toBe("I have fever and headache.");
  });

  it("appends a second recording instead of replacing the first", () => {
    expect(appendVoiceText("I have fever and headache.", "I also have weakness and body pain.")).toBe(
      "I have fever and headache. I also have weakness and body pain."
    );
  });

  it("ignores blank transcripts so retries never wipe text", () => {
    expect(appendVoiceText("Fever.", "   ")).toBe("Fever.");
  });

  it("normalizes whitespace at the join", () => {
    expect(appendVoiceText("Fever.  ", "  headache")).toBe("Fever. headache");
  });
});

describe("selectAsrBackend", () => {
  it("prefers an explicit AI4Bharat URL", () => {
    expect(selectAsrBackend({ AI4BHARAT_ASR_URL: "https://asr.example/x" })).toMatchObject({
      kind: "ai4bharat",
    });
  });

  it("selects Bhashini only with key AND pipeline id", () => {
    expect(selectAsrBackend({ BHASHINI_API_KEY: "k", BHASHINI_PIPELINE_ID: "p" })).toMatchObject({
      kind: "bhashini",
    });
  });

  it("calls out half-configuration instead of failing later", () => {
    const keyOnly = selectAsrBackend({ BHASHINI_API_KEY: "k" });
    expect(keyOnly.kind).toBe("misconfigured");
    if (keyOnly.kind === "misconfigured") expect(keyOnly.error).toMatch(/BHASHINI_PIPELINE_ID/);
    const pipelineOnly = selectAsrBackend({ BHASHINI_PIPELINE_ID: "p" });
    expect(pipelineOnly.kind).toBe("misconfigured");
  });

  it("reports none when nothing is configured", () => {
    expect(selectAsrBackend({}).kind).toBe("none");
  });
});
