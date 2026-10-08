import { describe, expect, it } from "vitest";
import {
  formatAbhaId,
  isAadhaarLike,
  isAcceptedIdentifier,
  identifierKind,
  isValidAadhaar,
  isValidAbhaId,
  isValidMobile,
} from "@/lib/abha";

describe("isValidAbhaId", () => {
  it("accepts 14-digit formatted ABHA", () => {
    expect(isValidAbhaId("11-0000-0001-2349")).toBe(true);
  });
  it("accepts raw 14 digits", () => {
    expect(isValidAbhaId("11000000012349")).toBe(true);
  });
  it("rejects short ids", () => {
    expect(isValidAbhaId("12-3456-7890")).toBe(false);
  });
  it("rejects misplaced dashes", () => {
    expect(isValidAbhaId("123-4567-890-12345")).toBe(false);
  });
  it("rejects non-digit content", () => {
    expect(isValidAbhaId("AB-CD-EF-GH".repeat(9))).toBe(false);
  });
});

describe("formatAbhaId", () => {
  it("formats 14 digits into 2-4-4-4", () => {
    expect(formatAbhaId("12345678901234")).toBe("12-3456-7890-1234");
  });
  it("leaves trailing digits out of the grouped part", () => {
    expect(formatAbhaId("1234567890123400")).toBe("12-3456-7890-123400");
  });
});

describe("isAadhaarLike", () => {
  it("detects 12-digit numbers", () => {
    expect(isAadhaarLike("234567890123")).toBe(true);
    expect(isAadhaarLike("23456789012")).toBe(false);
  });
});

describe("isValidMobile", () => {
  it("accepts Indian mobile starting 6-9", () => {
    expect(isValidMobile("9876543210")).toBe(true);
  });
  it("rejects numbers not starting 6-9", () => {
    expect(isValidMobile("1234567890")).toBe(false);
  });
  it("rejects short numbers", () => {
    expect(isValidMobile("98765")).toBe(false);
  });
});

/**
 * The "ABHA ID or Aadhaar" field regression.
 *
 * The kiosk labels the field as taking either format and renders a green tick
 * for a valid Aadhaar — but the Next button validated with `isValidAbhaId`,
 * which only accepts the 14-digit ABHA form. A correct 12-digit Aadhaar
 * therefore showed "Valid Aadhaar number" and then failed with "Please correct
 * the highlighted fields to continue."
 *
 * Numbers below are synthetic: check digits computed with the library's own
 * `verhoeffCheckDigit`, so they are structurally valid without belonging to any
 * real person. Do not paste a real Aadhaar into this file.
 */
const SYNTHETIC_AADHAAR = "234567890124"; // 12 digits, Verhoeff-valid
const SYNTHETIC_ABHA = "11-0000-0001-2349"; // 14 digits, Verhoeff-valid

describe("isAcceptedIdentifier", () => {
  it("accepts a Verhoeff-valid 12-digit Aadhaar", () => {
    expect(isValidAadhaar(SYNTHETIC_AADHAAR)).toBe(true);
    expect(isValidAbhaId(SYNTHETIC_AADHAAR)).toBe(false);
    expect(isAcceptedIdentifier(SYNTHETIC_AADHAAR)).toBe(true);
  });

  it("accepts a 14-digit ABHA", () => {
    expect(isAcceptedIdentifier(SYNTHETIC_ABHA)).toBe(true);
  });

  it("accepts the spaced Aadhaar form a person might type", () => {
    expect(isAcceptedIdentifier("2345 6789 0124")).toBe(true);
  });

  it("rejects a wrong Aadhaar check digit", () => {
    // Same digits, check digit changed — must not slip through.
    expect(isAcceptedIdentifier("234567890125")).toBe(false);
  });

  it("rejects wrong lengths and empty input", () => {
    expect(isAcceptedIdentifier("")).toBe(false);
    expect(isAcceptedIdentifier("   ")).toBe(false);
    expect(isAcceptedIdentifier("123456789")).toBe(false); // 9
    expect(isAcceptedIdentifier("123456789012345")).toBe(false); // 15
  });
});

describe("identifierKind", () => {
  it("distinguishes the two formats so the UI can message each", () => {
    expect(identifierKind(SYNTHETIC_ABHA)).toBe("abha");
    expect(identifierKind(SYNTHETIC_AADHAAR)).toBe("aadhaar");
  });

  it("returns null for anything not accepted", () => {
    expect(identifierKind("")).toBeNull();
    expect(identifierKind("12345")).toBeNull();
    expect(identifierKind("234567890125")).toBeNull();
  });
});