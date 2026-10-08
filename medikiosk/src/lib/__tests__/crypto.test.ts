import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, sha256Hex } from "@/lib/crypto";

const SECRET = "test-session-secret-12345";

describe("crypto (PHI at rest)", () => {
  it("round-trips a value through AES-256-GCM", () => {
    const obj = { encounters: [{ id: "e1", patient: { abhaId: "11-0000-0001-2349", name: "Sunita" } }] };
    const envelope = encryptJson(obj, SECRET);
    expect(envelope).not.toContain("Sunita"); // ciphertext must not leak plaintext
    expect(JSON.parse(envelope).v).toBe(1);
    expect(decryptJson<typeof obj>(envelope, SECRET)).toEqual(obj);
  });

  it("non-deterministic (random IV) — two encryptions differ", () => {
    const a = encryptJson({ x: 1 }, SECRET);
    const b = encryptJson({ x: 1 }, SECRET);
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext (auth tag mismatch)", () => {
    const envelope = encryptJson({ secret: true }, SECRET);
    const parsed = JSON.parse(envelope) as { data: string };
    parsed.data = parsed.data.slice(0, -2) + "AA";
    expect(() => decryptJson(JSON.stringify(parsed), SECRET)).toThrow();
  });

  it("throws on wrong secret", () => {
    const envelope = encryptJson({ secret: true }, SECRET);
    expect(() => decryptJson(envelope, "wrong-secret")).toThrow();
  });

  it("sha256Hex is deterministic and 64 hex chars", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
    expect(sha256Hex("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("hello")).not.toBe(sha256Hex("world"));
  });
});