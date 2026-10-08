import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";

/**
 * PHI-at-rest helpers: AES-256-GCM encryption for the JSON stores plus a
 * plain SHA-256 for integrity manifests (admin backups).
 *
 * The key is derived deterministically from SESSION_SECRET so the encrypted
 * store survives restarts without extra state. A wrong secret makes decryption
 * fail loudly (auth-tag mismatch) instead of silently corrupting data.
 */

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, "medikiosk-phi-v1", 32);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export type CiphertextEnvelope = { v: 1; iv: string; tag: string; data: string };

/** Serialise + encrypt any JSON-serialisable value. Output is a base64 JSON envelope. */
export function encryptJson(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const plain = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const envelope: CiphertextEnvelope = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: enc.toString("base64"),
  };
  return JSON.stringify(envelope);
}

/** Decrypt + parse an envelope produced by `encryptJson`. Throws on tamper/wrong key. */
export function decryptJson<T>(payload: string, secret: string): T {
  const envelope = JSON.parse(payload) as CiphertextEnvelope;
  if (envelope?.v !== 1) throw new Error("Unsupported ciphertext envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}