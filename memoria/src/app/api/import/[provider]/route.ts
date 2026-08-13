import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession } from "@/lib/dal";
import { cloudProvider, isCloudProviderEnabled } from "@/lib/import-providers";
import { downloadDriveFile } from "@/lib/drive/providers";
import { ingestPhoto, type IngestResult } from "@/lib/ingest";
import { logger } from "@/lib/logger";

const log = logger("api.import");

export const runtime = "nodejs";
export const maxDuration = 300;

const importSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(50),
});

/**
 * Import selected Drive files into the vault: download each, then run the
 * exact same ingest pipeline as a direct upload (hash dedupe, EXIF, thumb,
 * S3). Failures are per-file so one corrupt image doesn't sink the batch.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const user = await verifySession();
  const { provider: providerId } = await params;
  const def = cloudProvider(providerId);
  if (!def) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  if (!isCloudProviderEnabled(def)) {
    return NextResponse.json(
      { error: `${def.label} import is not configured on this server` },
      { status: 400 },
    );
  }

  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "fileIds must be a non-empty array" }, { status: 400 });
  }

  const results: IngestResult[] = [];
  for (const fileId of parsed.data.fileIds) {
    try {
      const { body, name, mimeType } = await downloadDriveFile(def, user.id, fileId);
      results.push(
        await ingestPhoto(new File([new Uint8Array(body)], name, { type: mimeType }), user.id),
      );
    } catch (err) {
      log.warn("cloud import failed for file", { provider: def.id, file_id: fileId }, err);
      results.push({
        status: "failed",
        filename: fileId,
        reason: err instanceof Error ? err.message : "Import failed",
      });
    }
  }

  if (results.some((r) => r.status === "created")) revalidatePath("/");

  return NextResponse.json({
    results,
    created: results.filter((r) => r.status === "created").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    failed: results.filter((r) => r.status === "failed").length,
  });
}
