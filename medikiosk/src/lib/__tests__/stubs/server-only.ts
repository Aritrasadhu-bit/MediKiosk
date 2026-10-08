/**
 * Stub for the `server-only` marker package, which Next.js provides as a
 * virtual module but is not present in node_modules. Vitest needs a real file
 * to resolve; the package only carries build-time semantics (it throws if
 * pulled into a client bundle), so an empty module is the correct stand-in.
 */
export {};
