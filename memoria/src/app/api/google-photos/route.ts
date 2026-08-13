import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession } from "@/lib/dal";
import { ingestPhoto, type IngestResult } from "@/lib/ingest";
import { downloadPickedItem, type PickedItem } from "@/lib/drive/google-photos";
import { logger } from "@/lib/logger";

const log = logger("api.google-photos");

export const runtime = "nodejs";
export const maxDuration = 300;

const itemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  baseUrl: z.url(),
});
const importSchema = z.object({ items: z.array(itemSchema).min(1).max(50) });

/**
 * Import the items the user picked in the Google Photos Picker UI. baseUrls
 * are short-lived, so the client posts right after the poll reports done.
 */
export async function POST(request: Request) {
  const user = await verifySession();
  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
  }

  const results: IngestResult[] = [];
  for (const item of parsed.data.items as PickedItem[]) {
    try {
      const body = await downloadPickedItem(item);
      results.push(
        await ingestPhoto(new File([new Uint8Array(body)], item.name, { type: item.mimeType }), user.id),
      );
    } catch (err) {
      log.warn("google photos import failed for item", { item_id: item.id }, err);
      results.push({
        status: "failed",
        filename: item.name,
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
