import "server-only";
import { log } from "./log";

/**
 * Shared minimal OpenAI JSON helper for the AI scribe / differential panel.
 * Returns null when no OPENAI_API_KEY is configured or the call fails — the
 * callers fall back to deterministic rule-based behaviour (offline-safe).
 */
export async function llmJson<T>(system: string, prompt: unknown): Promise<T | null> {
  const raw = await callOpenAi(system, prompt, { json: true });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    log("warn", "llm", "LLM returned unparseable JSON — using rule-based fallback");
    return null;
  }
}

/** True when a key is configured and a call could actually be made. */
export function llmAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Free-text completion. Returns null on any failure so callers fall back. */
export async function completeText(system: string, prompt: unknown): Promise<string | null> {
  return callOpenAi(system, prompt, { json: false, temperature: 0.3 });
}

type CallOptions = { json: boolean; temperature?: number };

/**
 * Single place where PHI can leave the hospital, so the guarantees live here:
 *   - bounded timeout (an LLM hang must not block a patient at the kiosk)
 *   - non-2xx and network failures return null instead of throwing
 *   - a response is size-capped before it is trusted
 */
async function callOpenAi(
  system: string,
  prompt: unknown,
  opts: CallOptions
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.OPENAI_TIMEOUT_MS ?? 20_000));
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(prompt) },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log("warn", "llm", "LLM returned a non-2xx status — using rule-based fallback", {
        status: res.status,
      });
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    // Cap the accepted text so a runaway completion cannot bloat the store.
    return content.slice(0, 20_000);
  } catch (e) {
    log("warn", "llm", "LLM call failed — using rule-based fallback", { error: String(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}