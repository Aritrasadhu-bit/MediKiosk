import "server-only";

import { promises as fs } from "fs";
import path from "path";

export type BuildInfo = { id: string; time: string | null };

/**
 * Which image build is serving traffic. Baked into public/build-info.json by
 * the Dockerfile (BUILD_ID/BUILD_TIME); absent on plain `next dev` /
 * `next start` runs, which report "dev". Non-sensitive by design — safe for
 * public endpoints and the admin deployment card.
 */
export async function buildInfo(): Promise<BuildInfo> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "public", "build-info.json"), "utf8");
    const parsed = JSON.parse(raw) as { id?: string; time?: string };
    if (typeof parsed.id === "string" && parsed.id) {
      return { id: parsed.id, time: typeof parsed.time === "string" ? parsed.time : null };
    }
  } catch {
    /* dev run without a baked image — fall through */
  }
  return { id: "dev", time: null };
}
