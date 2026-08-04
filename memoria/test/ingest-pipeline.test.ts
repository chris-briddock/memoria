// M5 — ingest pipeline integration tests. Real `sharp`/`exifr` run against
// committed fixture images; the S3 boundary (`putObject`) is mocked per the
// plan's mocking strategy, while the real Postgres `memoria_test` DB verifies
// the row that `ingestPhoto` writes. Run `npm run db:up` first.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// DATABASE_URL + pool reset live in setup.integration.ts (setupFiles).

// Keep the real `objectKey` (pure, content-addressed) but stub the network
// write so no RustFS/B2 is needed. Hoisted so the factory can reference it.
const { putObject } = vi.hoisted(() => ({ putObject: vi.fn() }));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, putObject };
});

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ingestPhoto, MAX_UPLOAD_BYTES } from "@/lib/ingest";

const FIXTURES = path.join(__dirname, "fixtures");

const UPLOADER = {
  id: randomUUID(),
  email: "ingester@test.dev",
  name: "Ingester",
  role: "member" as const,
};

function fileFrom(fixture: string, type: string, name = fixture): File {
  const bytes = readFileSync(path.join(FIXTURES, fixture));
  return new File([bytes], name, { type });
}

async function truncateAll() {
  await db.execute(
    sql`TRUNCATE album_photos, albums, photos, invites, users RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  await truncateAll();
  await db.insert(users).values([UPLOADER]);
});

beforeEach(() => {
  vi.clearAllMocks();
  putObject.mockResolvedValue(undefined);
});

describe("ingestPhoto", () => {
  it("rejects an unsupported MIME type before touching storage or the DB", async () => {
    const file = fileFrom("plain.png", "application/pdf", "doc.pdf");
    const result = await ingestPhoto(file, UPLOADER.id);

    expect(result).toEqual({
      status: "failed",
      filename: "doc.pdf",
      reason: "Unsupported file type application/pdf",
    });
    expect(putObject).not.toHaveBeenCalled();
  });

  it("rejects a file over the 50 MB cap", async () => {
    // Fake the size rather than allocating 50 MB: a File's `size` is read off
    // the instance, and ingest checks it before reading any bytes.
    const real = fileFrom("plain.png", "image/png");
    const big = new File([real], "huge.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: MAX_UPLOAD_BYTES + 1 });

    const result = await ingestPhoto(big, UPLOADER.id);

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ reason: "File is larger than 50 MB" });
    expect(putObject).not.toHaveBeenCalled();
  });

  it("creates a row and writes both objects on the happy path", async () => {
    await truncateAll();
    await db.insert(users).values([UPLOADER]);

    const file = fileFrom("plain.png", "image/png");
    const result = await ingestPhoto(file, UPLOADER.id);

    expect(result.status).toBe("created");
    const photoId = (result as { photoId: string }).photoId;

    // Two object writes: original bytes and the derived webp thumbnail.
    expect(putObject).toHaveBeenCalledTimes(2);
    const [origCall, thumbCall] = putObject.mock.calls;
    expect(origCall[0]).toMatch(/^[\da-f]{2}\/[\da-f]{64}\/orig\.png$/);
    expect(origCall[2]).toBe("image/png");
    expect(thumbCall[0]).toMatch(/^[\da-f]{2}\/[\da-f]{64}\/thumb\.webp$/);
    expect(thumbCall[2]).toBe("image/webp");

    const row = await db.query.photos.findFirst({
      where: (p, { eq }) => eq(p.id, photoId),
    });
    expect(row).toMatchObject({
      originalFilename: "plain.png",
      mimeType: "image/png",
      width: 800,
      height: 600,
      uploadedBy: UPLOADER.id,
    });
    // No EXIF in the PNG, so takenAt falls back to "now-ish".
    expect(row?.takenAt).toBeInstanceOf(Date);
  });

  it("swaps width/height when EXIF orientation >= 5", async () => {
    await truncateAll();
    await db.insert(users).values([UPLOADER]);

    // rotated.jpg is stored 1200x800 with Orientation=6 (90° CW), so the
    // displayed image is 800x1200.
    const file = fileFrom("rotated.jpg", "image/jpeg");
    const result = await ingestPhoto(file, UPLOADER.id);

    expect(result.status).toBe("created");
    const photoId = (result as { photoId: string }).photoId;
    const row = await db.query.photos.findFirst({
      where: (p, { eq }) => eq(p.id, photoId),
    });
    expect(row?.width).toBe(800);
    expect(row?.height).toBe(1200);
  });

  it("uses the EXIF DateTimeOriginal as takenAt when present", async () => {
    await truncateAll();
    await db.insert(users).values([UPLOADER]);

    const file = fileFrom("rotated.jpg", "image/jpeg");
    const result = await ingestPhoto(file, UPLOADER.id);
    const photoId = (result as { photoId: string }).photoId;
    const row = await db.query.photos.findFirst({
      where: (p, { eq }) => eq(p.id, photoId),
    });

    // The fixture's EXIF DateTimeOriginal is 2019-06-15 12:34:56. exifr reads
    // naive EXIF times via the process timezone, so assert the instant
    // relative to the local timezone rather than a hard-coded ISO string.
    expect(row?.takenAt?.valueOf()).toBe(new Date(2019, 5, 15, 12, 34, 56).valueOf());
  });

  it("returns duplicate instead of a second row for identical bytes", async () => {
    await truncateAll();
    await db.insert(users).values([UPLOADER]);

    const first = await ingestPhoto(fileFrom("plain.png", "image/png"), UPLOADER.id);
    expect(first.status).toBe("created");
    const firstId = (first as { photoId: string }).photoId;

    putObject.mockClear();
    const second = await ingestPhoto(fileFrom("plain.png", "image/png"), UPLOADER.id);

    expect(second).toEqual({
      status: "duplicate",
      photoId: firstId,
      filename: "plain.png",
    });
    // Dedupe short-circuits before any storage write.
    expect(putObject).not.toHaveBeenCalled();

    const count = await db.query.photos.findMany();
    expect(count).toHaveLength(1);
  });

  it("reports a sharp failure for corrupt image bytes", async () => {
    await truncateAll();
    await db.insert(users).values([UPLOADER]);

    const file = fileFrom("corrupt.jpg", "image/jpeg");
    const result = await ingestPhoto(file, UPLOADER.id);

    expect(result.status).toBe("failed");
    expect((result as { reason: string }).reason).toBeTruthy();
    expect(putObject).not.toHaveBeenCalled();
  });
});
