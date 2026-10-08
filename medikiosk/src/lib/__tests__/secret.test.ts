import { describe, expect, it } from "vitest";

/**
 * Production secret policy.
 *
 * The original finding: SESSION_SECRET fell back to the literal
 * "medikiosk-dev-secret-change-me", which is committed in .env.example. Anyone
 * who read the repo could forge an admin session cookie and derive the
 * PHI-at-rest encryption key. These tests pin the replacement policy.
 *
 * The module is loaded in a child process because it reads process.env once and
 * caches the resolved value for the life of the process — which is exactly the
 * behaviour that makes in-process re-testing impossible.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const SECRET_MODULE = path.resolve(__dirname, "../server/secret.ts");

function loadSecretModule(env: Record<string, string | undefined>): { ok: boolean; output: string } {
  const script = `
    const m = require(${JSON.stringify(SECRET_MODULE)});
    try {
      const s = m.sessionSecret();
      console.log("SECRET_LEN=" + s.length);
    } catch (e) {
      console.log("THREW=" + e.message.split("\\n")[0].slice(0, 90));
    }
  `;
  try {
    const output = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "-e", script],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production", ...env } as NodeJS.ProcessEnv,
      }
    );
    return { ok: true, output };
  } catch (err) {
    // A non-zero exit still tells us the module refused to produce a secret.
    const out = `${(err as { stdout?: string }).stdout ?? ""}${(err as { stderr?: string }).stderr ?? ""}`;
    return { ok: false, output: out };
  }
}

describe("session secret policy in production", () => {
  it("refuses to run when SESSION_SECRET is absent", () => {
    const { output } = loadSecretModule({ SESSION_SECRET: undefined });
    expect(output).toMatch(/THREW=/);
    expect(output).not.toMatch(/SECRET_LEN/);
  });

  it("refuses the published placeholder value", () => {
    // This exact string is in .env.example and in the git history.
    const { output } = loadSecretModule({ SESSION_SECRET: "medikiosk-dev-secret-change-me" });
    expect(output).toMatch(/THREW=/);
    expect(output).not.toMatch(/SECRET_LEN/);
  });

  it("refuses other well-known placeholder values", () => {
    for (const bad of ["change-me", "changeme", "secret", "medikiosk"]) {
      const { output } = loadSecretModule({ SESSION_SECRET: bad });
      expect(output, bad).toMatch(/THREW=/);
    }
  });

  it("refuses a trivially short secret", () => {
    // Length, not just the blacklist: "aaaa..." is not on the list but is
    // just as guessable.
    const { output } = loadSecretModule({ SESSION_SECRET: "aaaaaaaaaaaaaaaa" });
    expect(output).toMatch(/THREW=/);
  });

  it("refuses fill-in-the-blank template values that are long enough to pass a length check", () => {
    // The .env.example line is 48 characters, so a length-only policy accepts
    // it — and a deployment that copied the example file verbatim would be
    // running with a publicly known signing key.
    for (const bad of [
      "replace-me-with-a-generated-64-character-hex-value",
      "CHANGE_ME_WITH_A_GENERATED_SECRET_VALUE_32B",
      "your-session-secret-goes-here-please-fill-in",
      "<generate-with-crypto-random-bytes>",
      "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "TODO-generate-a-real-32-byte-secret-value",
    ]) {
      const { output } = loadSecretModule({ SESSION_SECRET: bad });
      expect(output, bad).toMatch(/THREW=/);
      expect(output, bad).not.toMatch(/SECRET_LEN/);
    }
  });

  it("still accepts a high-entropy secret that merely contains common words", () => {
    // The pattern list must not reject a legitimately generated key.
    const real = "3c1a7e5b9d2f40816a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f";
    const { output } = loadSecretModule({ SESSION_SECRET: real });
    expect(output).toMatch(/SECRET_LEN=64/);
  });

  it("accepts a real secret and uses it", () => {
    const real = "6f1d8c0b9a2e4f7c8b1d5e3a9c7f2b4d6e8a1c3f5b7d9e1a3c5f7b9d1e3a5c7f";
    const { output } = loadSecretModule({ SESSION_SECRET: real });
    expect(output).toMatch(/SECRET_LEN=64/);
  });

  it("trims surrounding whitespace from a real secret", () => {
    const real = "9b3e7d1f5a2c4e6f8a0b2d4f6e8c1a3b5d7f9e1a3c5b7d9f1e3a5c7b9d1f3a5c";
    const { output } = loadSecretModule({ SESSION_SECRET: `  ${real}  ` });
    expect(output).toMatch(/SECRET_LEN=64/);
  });
});
