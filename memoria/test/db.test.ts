import { describe, expect, it, vi } from "vitest";

// Regression test for build-time imports: importing `@/db` must not require
// DATABASE_URL to be set. Next.js imports route modules during `next build`
// page-data collection, and route modules import `@/db`.
describe("@/db", () => {
  it("can be imported without DATABASE_URL", async () => {
    // setup.ts provides a DATABASE_URL for the integration suites; override it
    // here so this test actually exercises the lazy-init path. `fileParallelism:
    // false` keeps this from leaking into other files.
    vi.stubEnv("DATABASE_URL", "");
    delete process.env.DATABASE_URL;
    delete (globalThis as { pool?: unknown }).pool;
    delete (globalThis as { db?: unknown }).db;

    const mod = await import("@/db");
    expect(mod.db).toBeTruthy();
  });
});
