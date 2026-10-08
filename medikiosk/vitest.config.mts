import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next supplies `server-only` as a virtual module; it is not on disk, so
      // point it at a stub for tests that import server modules directly.
      "server-only": path.resolve(__dirname, "src/lib/__tests__/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Only the pure logic modules — no browser/DOM required.
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/**/*.test.ts",
        "src/lib/server/**",
        "src/lib/useSession.ts",
        "src/lib/store.ts",
        "src/lib/speech.ts",
        "src/lib/imageProcess.ts",
        "src/lib/callChannel.ts",
        "src/lib/data.ts",
        "src/lib/demoData.ts",
      ],
    },
  },
});