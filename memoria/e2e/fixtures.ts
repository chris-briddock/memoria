import path from "node:path";
import pg from "pg";
import type { Browser, BrowserContext } from "@playwright/test";

export const ADMIN = {
  name: "E2E Admin",
  email: "admin@e2e.dev",
  password: "e2e-admin-password",
};

export const MEMBER = {
  name: "E2E Member",
  email: "member@e2e.dev",
  password: "e2e-member-password",
};

/** Where Playwright stores the authenticated browser state per persona. */
export function authFile(persona: "admin" | "member"): string {
  return path.join(__dirname, ".auth", `${persona}.json`);
}

/** Committed fixture images shared with the unit ingest suite. */
export function fixtureImage(name: "plain.png" | "rotated.jpg" | "corrupt.jpg") {
  return path.join(__dirname, "..", "test", "fixtures", name);
}

const E2E_URL =
  "postgresql://memoria:memoria_dev_password@localhost:5432/memoria_e2e";

/**
 * Wipes user-generated rows so each spec starts from just the seeded accounts.
 * Specs run serially (workers: 1), so a truncate between tests cannot race.
 * Keeps the two known accounts so signed-in specs stay valid; cascades clear
 * their photos, albums and invites.
 */
export async function resetData() {
  const client = new pg.Client({ connectionString: E2E_URL });
  await client.connect();
  try {
    await client.query(
      "TRUNCATE album_photos, albums, photos, invites RESTART IDENTITY CASCADE",
    );
    // Remove any accounts created by earlier specs (e.g. invite registrations),
    // keeping the two canonical personas so saved sessions still resolve.
    await client.query("DELETE FROM users WHERE email NOT IN ($1, $2)", [
      ADMIN.email,
      MEMBER.email,
    ]);
    // Specs may mutate a persona's profile (e.g. members.spec.ts renames the
    // member). Restore canonical names so later specs that assert on them are
    // not order-dependent.
    await client.query("UPDATE users SET name = $2 WHERE email = $1", [
      ADMIN.email,
      ADMIN.name,
    ]);
    await client.query("UPDATE users SET name = $2 WHERE email = $1", [
      MEMBER.email,
      MEMBER.name,
    ]);
  } finally {
    await client.end();
  }
}

/** Opens a short-lived connection to the disposable e2e database. */
export async function withDb<T>(fn: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: E2E_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Mints an invite row directly, bypassing the UI. Setup uses this to register
 * the member persona; specs that need an invite without exercising the invite
 * form can use it too. Pass an interval like `-1 day` to create an expired
 * invite.
 */
export async function seedInvite(
  note = "e2e seed",
  expiresIn = "30 days",
): Promise<string> {
  const code = `E2E2-E2E2-${Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z2-9]/g, "K").padEnd(4, "K")}`;
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO invites (code, note, expires_at)
       VALUES ($1, $2, now() + $3::interval)`,
      [code, note, expiresIn],
    );
  });
  return code;
}

/**
 * Inserts a photo row owned by the admin persona without touching the S3
 * bucket — enough for specs that only need the photo to appear in the UI
 * (membership checks, delete-button visibility), not to stream real bytes.
 * Returns the new photo id.
 */
export async function seedPhoto(filename: string): Promise<string> {
  return withDb(async (db) => {
    const { rows: admins } = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [ADMIN.email],
    );
    const checksum = Math.random().toString(36).slice(2);
    const { rows } = await db.query(
      `INSERT INTO photos (storage_key, thumb_key, original_filename, mime_type, byte_size, checksum, taken_at, uploaded_by)
       VALUES ($1, $2, $3, 'image/jpeg', 1234, $4, now(), $5)
       RETURNING id`,
      [`e2e/${checksum}/orig.jpg`, `e2e/${checksum}/thumb.webp`, filename, checksum, admins[0].id],
    );
    return rows[0].id as string;
  });
}

/** Creates an album owned by the admin persona. Returns the new album id. */
export async function seedAlbum(name: string): Promise<string> {
  return withDb(async (db) => {
    const { rows: admins } = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [ADMIN.email],
    );
    const { rows } = await db.query(
      `INSERT INTO albums (name, created_by) VALUES ($1, $2) RETURNING id`,
      [name, admins[0].id],
    );
    return rows[0].id as string;
  });
}

/** True when the member persona already exists (member setup is idempotent). */
export async function userExists(email: string): Promise<boolean> {
  return withDb(async (db) => {
    const { rows } = await db.query("SELECT 1 FROM users WHERE email = $1", [
      email,
    ]);
    return rows.length > 0;
  });
}

/**
 * A genuinely signed-out browser context. Playwright applies the project's
 * storageState to `browser.newContext()`, so a naive fresh context would
 * still carry the persona's session cookie; this strips it. baseURL must be
 * passed explicitly — manually created contexts do not inherit the config's.
 */
export async function guestContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: "http://localhost:3100",
    storageState: { cookies: [], origins: [] },
  });
  await context.clearCookies();
  return context;
}
