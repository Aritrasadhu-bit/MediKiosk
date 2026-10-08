import { randomBytes, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

/**
 * Single source of truth for the server-side signing/encryption secret.
 *
 * Why this module exists: `SESSION_SECRET` used to fall back to a *published*
 * literal ("medikiosk-dev-secret-change-me", committed in .env.example). Any
 * party who read the repo could forge a valid admin session cookie or derive
 * the PHI-at-rest encryption key. That is an authentication bypass, not a
 * cosmetic warning.
 *
 * Policy now:
 *   - SESSION_SECRET set to a real value -> use it.
 *   - production                       -> throw. Never fall back to a guessable value.
 *   - development                      -> use a generated secret persisted in the
 *                                         data dir, so every bundle (route
 *                                         handlers *and* proxy.ts) agrees on it
 *                                         and sessions survive a restart.
 *
 * Import note: this module is loaded by the Node runtime (server-only modules)
 * and by src/proxy.ts, which Next 16 always runs on Node.js. That shared
 * fs-backed dev secret is what keeps the two bundles in agreement — a
 * per-process `randomBytes` would sign in the auth module and verify with a
 * different key in the proxy, breaking every login.
 */

const PLACEHOLDERS = new Set([
  "medikiosk-dev-secret-change-me",
  "change-me",
  "changeme",
  "secret",
  "medikiosk",
]);

/**
 * Substrings that mean the value is a template rather than a generated key.
 * The exact-match set above is not enough: a `.env.example` line like
 * `SESSION_SECRET=replace-me-with-a-generated-64-character-hex-value` is long
 * enough to pass a length check and is not equal to any listed placeholder, so
 * a deployment that copied the example file verbatim would be running with a
 * publicly known signing key. Anything that looks like a fill-in-the-blank
 * template is rejected outright.
 */
const PLACEHOLDER_PATTERNS = [
  /replace[-_ ]?me/i,
  /change[-_ ]?me/i,
  /changeme/i,
  /placeholder/i,
  /your[-_ ]/i,
  /example/i,
  /\btodo\b/i,
  /insert[-_ ]/i,
  /^<.*>$/,
  /^(?:x+|\.+)$/i,
  /\bx{8,}/i,
  /\b(?:aaaa|0000|1234|abcd)\b/i,
];

const isProduction = process.env.NODE_ENV === "production";

/** 32 chars of hex = 256 bits, the output size of the documented generator. */
const MIN_SECRET_LENGTH = 32;

/** True when a secret was supplied and is not a shipped placeholder. */
function suppliedSecretIsReal(): boolean {
  const raw = process.env.SESSION_SECRET;
  if (!raw) return false;
  const trimmed = raw.trim();
  // 32 is the floor, not 16: this key also derives the AES-256-GCM key that
  // encrypts PHI at rest, and a 16-character secret is trivially brute-forced
  // offline by anyone who reads this repository.
  if (trimmed.length < MIN_SECRET_LENGTH) return false;
  if (PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
  return !PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Read the generated development secret, creating it on first run.
 * Stored beside the rest of the server state so proxy and route handlers in
 * separate bundles resolve the same key.
 */
function dataDirPath(): string {
  // Keep the path statically rooted at <cwd>/data so the bundler does not
  // trace the whole project for a dynamic filesystem read. MEDIKIOSK_DATA_DIR
  // is an escape hatch for deployments that mount state elsewhere; it is only
  // read when set, which keeps the common case analysable.
  // The turbopackIgnore opt-out keeps the bundler from tracing the whole
  // project for this one read; the path is state, not application source.
  return process.env.MEDIKIOSK_DATA_DIR
    ? path.join(/* turbopackIgnore: true */ process.cwd(), process.env.MEDIKIOSK_DATA_DIR)
    : path.join(process.cwd(), "data");
}

function loadOrCreateDevSecret(): string {
  const dataDir = dataDirPath();
  const secretFile = path.join(dataDir, ".dev-session-secret");
  try {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    if (existsSync(secretFile)) {
      const existing = readFileSync(secretFile, "utf8").trim();
      if (existing.length >= 32 && !PLACEHOLDERS.has(existing.toLowerCase())) return existing;
    }
    const fresh = generateSecret();
    writeFileSync(secretFile, `${fresh}\n`, { encoding: "utf8", mode: 0o600 });
    return fresh;
  } catch (err) {
    // A read-only data dir must not take the dev server down. Fall back to a
    // per-process value; the trade-off is invalidated sessions on restart.
    console.warn(
      `[medikiosk] Could not persist a development secret (${(err as Error).message}). ` +
        "Using an in-memory secret; sessions will reset on restart.",
    );
    return generateSecret();
  }
}

/**
 * Resolve the secret on first use rather than at module load.
 *
 * This is deliberate: `next build` sets NODE_ENV=production and imports every
 * route module to collect page data. Throwing during import would make the
 * build itself impossible to complete without a production secret on the
 * developer's machine, which is the wrong trade — a build artefact does not
 * need a signing key, only the server that serves requests does. Deferring the
 * throw means the build succeeds and the misconfiguration surfaces as a loud
 * error on the first real request, before any cookie is ever signed.
 */
let cached: string | null = null;

function resolveSecret(): string {
  if (suppliedSecretIsReal()) return process.env.SESSION_SECRET!.trim();

  if (isProduction) {
    // Fail closed and loudly. A deployment without a real secret is a
    // deployment where anyone can mint an admin session.
    throw new Error(
      "[medikiosk] SESSION_SECRET is missing or is a known placeholder value. " +
        "Refusing to sign in production — session cookies and PHI-at-rest " +
        "encryption would both be forgeable. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" " +
        "and set it in the environment (see .env.example).",
    );
  }

  console.warn(
    "[medikiosk] SESSION_SECRET is not set. Generated a development secret in " +
      "the data dir. Set SESSION_SECRET in .env.local for reproducible sessions.",
  );
  return loadOrCreateDevSecret();
}

/**
 * The active secret. Call this instead of capturing a module-level constant so
 * the resolution happens at request time and the two independently-bundled
 * halves of the app (route handlers and proxy.ts) always agree.
 */
export function sessionSecret(): string {
  if (cached === null) cached = resolveSecret();
  return cached;
}

/** True when a real, non-placeholder secret backs the current process. */
export function usingEphemeralSecret(): boolean {
  return !suppliedSecretIsReal();
}

/**
 * Constant-time string comparison for secrets/tokens of arbitrary length.
 * Returns false on length mismatch (lengths of HMAC digests are not secret).
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
