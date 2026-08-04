import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import packageJson from "./package.json";

/** Short commit hash for the version badge. Vercel exposes the deploying
 * commit via VERCEL_GIT_COMMIT_SHA; locally and in CI we ask git directly. */
function commitHash(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Keep native / Node-only server packages out of the bundle so Turbopack
  // doesn't have to trace their conditional builtin imports. `exifr`'s full
  // build probes fs/zlib/http/https at module-evaluation time and
  // console.warn-s "Couldn't load fs/zlib" when those Node built-ins can't
  // resolve inside the bundler's static-generation workers; externalizing it
  // makes Node load the package natively where the built-ins exist.
  serverExternalPackages: ["sharp", "pg", "@aws-sdk/client-s3", "exifr"],
  env: {
    APP_VERSION: packageJson.version,
    APP_COMMIT: commitHash(),
  },
};

export default nextConfig;
