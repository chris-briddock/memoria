import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import exifr from "exifr";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { photos } from "@/db/schema";
import { objectKey, putObject } from "./storage";

export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/tiff",
  "image/heic",
  "image/heif",
];

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB per file

const THUMB_WIDTH = 640;

export type IngestResult =
  | { status: "created"; photoId: string; filename: string }
  | { status: "duplicate"; photoId: string; filename: string }
  | { status: "failed"; filename: string; reason: string };

export function extensionFor(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    case "image/gif":
      return "gif";
    case "image/tiff":
      return "tiff";
    case "image/heic":
    case "image/heif":
      return "heic";
    default:
      return "jpg";
  }
}

/** EXIF capture time, falling back through the usual tag variants. */
async function readTakenAt(buffer: Buffer): Promise<Date | null> {
  try {
    const exif = await exifr.parse(buffer, {
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate"],
    });
    const raw = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.ModifyDate;
    if (raw instanceof Date && !Number.isNaN(raw.valueOf())) return raw;
  } catch {
    // Not all formats carry EXIF; absence is not an error.
  }
  return null;
}

/**
 * Hashes, de-duplicates, derives a thumbnail, and records one uploaded image.
 * Identical bytes uploaded twice resolve to the existing row rather than a
 * second copy — families re-upload the same photo constantly.
 */
export async function ingestPhoto(
  file: File,
  userId: string,
): Promise<IngestResult> {
  const filename = file.name || "untitled";

  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return { status: "failed", filename, reason: `Unsupported file type ${file.type}` };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { status: "failed", filename, reason: "File is larger than 50 MB" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(buffer).digest("hex");

  const existing = await db.query.photos.findFirst({
    where: eq(photos.checksum, checksum),
  });
  if (existing) {
    return { status: "duplicate", photoId: existing.id, filename };
  }

  let width: number | null = null;
  let height: number | null = null;
  let thumbnail: Buffer;

  try {
    const image = sharp(buffer, { failOn: "none" });
    const metadata = await image.metadata();
    // `autoOrient` bakes in EXIF rotation so the thumbnail matches the original.
    const oriented = sharp(buffer, { failOn: "none" }).autoOrient();

    // Width/height must reflect the oriented image, not the stored pixel grid.
    const swap = metadata.orientation !== undefined && metadata.orientation >= 5;
    width = (swap ? metadata.height : metadata.width) ?? null;
    height = (swap ? metadata.width : metadata.height) ?? null;

    thumbnail = await oriented
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    return {
      status: "failed",
      filename,
      reason: err instanceof Error ? err.message : "Could not read image",
    };
  }

  const takenAt = await readTakenAt(buffer);

  const storageKey = objectKey(checksum, "orig", extensionFor(file.type));
  const thumbKey = objectKey(checksum, "thumb", "webp");

  await Promise.all([
    putObject(storageKey, buffer, file.type),
    putObject(thumbKey, thumbnail, "image/webp"),
  ]);

  const [row] = await db
    .insert(photos)
    .values({
      storageKey,
      thumbKey,
      originalFilename: filename,
      mimeType: file.type,
      byteSize: buffer.byteLength,
      width,
      height,
      checksum,
      takenAt: takenAt ?? new Date(),
      uploadedBy: userId,
    })
    .returning({ id: photos.id });

  return { status: "created", photoId: row.id, filename };
}
