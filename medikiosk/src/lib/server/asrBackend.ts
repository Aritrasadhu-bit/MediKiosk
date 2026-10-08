import "server-only";

/**
 * Server transcription backend selection.
 *
 * A half-configured backend is the classic 3am failure: a key without its
 * pipeline id (or vice versa) used to surface as a generic 500
 * "Transcription failed" after a wasted upstream round-trip. Resolving the
 * backend up front turns that into an explicit, actionable 501 so the kiosk
 * falls back to on-device speech immediately — and misconfiguration is
 * visible in one place instead of scattered across branches.
 */

export type AsrBackendSelection =
  | { kind: "ai4bharat"; url: string }
  | { kind: "bhashini" }
  | { kind: "none" }
  | { kind: "misconfigured"; error: string };

export type AsrEnv = {
  AI4BHARAT_ASR_URL?: string;
  BHASHINI_API_KEY?: string;
  BHASHINI_PIPELINE_ID?: string;
  // Index signature so process.env (and other string maps) are assignable —
  // a weak type of only-optional props rejects them at compile time.
  [key: string]: string | undefined;
};

export function selectAsrBackend(env: AsrEnv): AsrBackendSelection {
  if (env.AI4BHARAT_ASR_URL) return { kind: "ai4bharat", url: env.AI4BHARAT_ASR_URL };
  const key = env.BHASHINI_API_KEY;
  const pipeline = env.BHASHINI_PIPELINE_ID;
  if (key && !pipeline) {
    return {
      kind: "misconfigured",
      error: "BHASHINI_API_KEY is set but BHASHINI_PIPELINE_ID is missing — set both or neither.",
    };
  }
  if (!key && pipeline) {
    return {
      kind: "misconfigured",
      error: "BHASHINI_PIPELINE_ID is set but BHASHINI_API_KEY is missing — set both or neither.",
    };
  }
  if (key && pipeline) return { kind: "bhashini" };
  return { kind: "none" };
}
