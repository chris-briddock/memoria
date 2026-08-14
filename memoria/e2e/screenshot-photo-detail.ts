/**
 * One-off: capture the photo details screen at phone width.
 * Usage: npx tsx e2e/screenshot-photo-detail.ts
 * Boots `next dev` on 3100 against .env.e2e, signs in as the e2e admin,
 * uploads a fixture, and writes e2e/screenshots/photo-detail-mobile.png.
 */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = path.join(__dirname, "..");
const PORT = "3200";
const BASE = `http://localhost:${PORT}`;

function loadEnvE2e(): Record<string, string> {
  const file = path.join(ROOT, ".env.e2e");
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

async function waitForServer(timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not start in time");
}

async function main() {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...loadEnvE2e(),
    AUTH_URL: BASE,
  };

  // Ensure e2e db schema is in sync before the dev server starts.
  execFileSync("npx", ["drizzle-kit", "push", "--force"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });

  const server = spawn("npm", ["run", "dev", "--", "--port", PORT], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  const shutdown = () => {
    server.kill("SIGTERM");
  };
  process.on("SIGINT", shutdown);
  process.on("exit", shutdown);

  try {
    await waitForServer(180_000);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    });
    const page = await context.newPage();

    // Sign in with the canonical e2e admin (register first boot if needed).
    await page.goto("/signin");
    await page.getByLabel("Email").fill("admin@e2e.dev");
    await page.getByLabel("Password").fill("e2e-admin-password");
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await page.waitForURL(/\/$/);

    // Upload a known-good fixture via the real uploader input.
    await page.waitForSelector("text=Choose photos");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose photos" }).click();
    await (await chooser).setFiles(
      path.join(ROOT, "test", "fixtures", "rotated.jpg"),
    );
    await page.getByRole("status").waitFor();

    // Open the photo details page.
    await page.getByRole("img", { name: "rotated.jpg" }).first().click();
    await page.waitForURL(/\/photos\//);
    // Let the original image load before capturing.
    await page.waitForSelector("img[src$='/orig']");

    // Wait for images to settle, then capture full page and viewport.
    const dir = path.join(ROOT, "e2e", "screenshots");
    execFileSync("mkdir", ["-p", dir]);
    await page.screenshot({
      path: path.join(dir, "photo-detail-mobile-viewport.png"),
      fullPage: false,
    });
    await page.screenshot({
      path: path.join(dir, "photo-detail-mobile-full.png"),
      fullPage: true,
    });

    // Also grab a desktop comparison shot.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: path.join(dir, "photo-detail-desktop.png"),
      fullPage: true,
    });

    // Console-check horizontal overflow on mobile.
    await page.setViewportSize({ width: 412, height: 915 });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    console.log(`[screenshot] horizontal overflow on mobile: ${overflow}px`);

    await browser.close();
  } finally {
    shutdown();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
