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
  env: {
    APP_VERSION: packageJson.version,
    APP_COMMIT: commitHash(),
  },
};

export default nextConfig;
