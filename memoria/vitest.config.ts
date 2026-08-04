import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// EXIF timestamps are parsed with exifr, which converts naive local times via
// the process timezone. Pin the suite to UTC so timestamp assertions are the
// same on every machine and in CI.
process.env.TZ = "UTC";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": "./test/stubs/server-only.js",
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.integration.ts"],
    // Integration suites (queries, ingest-pipeline, actions) share the single
    // `memoria_test` database and each TRUNCATEs it. Running test files in
    // parallel workers makes one file's truncate wipe another's fixtures, so
    // run files sequentially. Unit tests are fast enough that this costs
    // little, and it keeps every suite order-independent.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/components/photo-grid.tsx"],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
