import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    globalSetup: ["./src/test/globalSetup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    // All test files share ONE in-memory MongoDB (see globalSetup.ts) and
    // several tests mutate/clear whole shared collections (audit log
    // chain, districts). Running files in parallel would interleave
    // writes across files against that shared database — force
    // sequential file execution so each file's beforeAll/afterEach
    // lifecycle is not racing another file's.
    fileParallelism: false,
  },
});
