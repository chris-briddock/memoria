import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { FullConfig } from "@playwright/test";

const ROOT = path.join(__dirname, "..");
const ADMIN_URL =
  "postgresql://memoria:memoria_dev_password@localhost:5432/postgres";
const E2E_DB = "memoria_e2e";
const E2E_URL = `postgresql://memoria:memoria_dev_password@localhost:5432/${E2E_DB}`;

/**
 * Prepares the throwaway e2e backend before any spec runs:
 *  1. create the `memoria_e2e` database if absent,
 *  2. push the current Drizzle schema into it,
 *  3. make sure the RustFS bucket exists.
 * Both the database and bucket are disposable — a fresh `docker compose up`
 * plus this setup reproduces the whole backend.
 */
export default async function globalSetup(_config: FullConfig) {
  await ensureDatabase();
  pushSchema();
  await ensureBucket();
}

async function ensureDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [E2E_DB],
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE ${E2E_DB}`);
    }
  } finally {
    await admin.end();
  }
}

function pushSchema() {
  // drizzle-kit push applies schema.ts directly — faster than replaying
  // migrations and always in sync for a scratch database.
  execFileSync("npx", ["drizzle-kit", "push", "--force"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: E2E_URL },
    stdio: "inherit",
  });
}

async function ensureBucket() {
  const s3 = new S3Client({
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: "memoria",
      secretAccessKey: "memoria_dev_secret",
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = "memoria-e2e-photos";
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket }));
  }
}
