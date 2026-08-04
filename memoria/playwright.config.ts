import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * e2e runs the real app against the docker-compose stack: a disposable
 * `memoria_e2e` Postgres database and the local RustFS S3 container. Start the
 * stack first (`npm run db:up`), then `npm run e2e`. Playwright boots
 * `next dev` on port 3100 with the e2e env itself via `webServer`.
 *
 * The app env comes from `.env.e2e`; we hand it to the webServer process so
 * Next.js picks up the e2e DATABASE_URL / S3_* / AUTH_* rather than .env.local.
 */
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // shared memoria_e2e DB — run specs serially
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // One-time bootstrap: registers the admin and member, saving both sessions.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Signed-out specs (guard redirects, sign-in form) must not load a session.
    {
      name: "anonymous",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
      dependencies: ["setup"],
    },
    // Default persona: the bootstrap admin. Excludes the files claimed by the
    // anonymous and member projects so each spec runs exactly once.
    {
      name: "admin",
      testIgnore: [/(auth|members)\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/admin.json",
      },
      dependencies: ["setup"],
    },
    // Specs written for the plain-member persona opt in via testMatch.
    {
      name: "member",
      testMatch: /members\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/member.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Load .env.e2e into the dev-server process. Next.js would otherwise
      // read .env.local (the dev database) and the tests would touch real data.
      ...loadEnvE2e(),
    },
  },
});

/** Parse .env.e2e into a plain object for the webServer's environment. */
function loadEnvE2e(): Record<string, string> {
  const file = path.join(__dirname, ".env.e2e");
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = new RegExp(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/).exec(line);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}
