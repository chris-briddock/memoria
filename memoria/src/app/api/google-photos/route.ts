import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession } from "@/lib/dal";
import { ingestPhoto, type IngestResult } from "@/lib/ingest";
import { cloudProvider } from "@/lib/import-providers";
import {
  downloadPickedItem,
  pollPickerSession,
} from "@/lib/drive/google-photos";
import { logger } from "@/lib/logger";

const log = logger("api.google-photos");

export const runtime = "nodejs";
export const maxDuration = 300;

const importSchema = z.object({ sessionId: z.string().min(1) });

/**
 * Import the media items the user confirmed in Google's Picker UI. The
 * client sends only the session id; the item list (and each baseUrl) is
 * re-resolved server-side from the Picker API so no client-supplied URL is
 * ever fetched, and items are downloaded with this user's own token.
 */
export async function POST(request: Request) {
  const user = await verifySession();
  const provider = cloudProvider("gdrive");
  if (!provider) {
    log.error("gdrive provider missing from registry");
    return NextResponse.json({ error: "Google Photos is not available" }, { status: 500 });
  }

  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  let items;
  try {
    items = await pollPickerSession(provider, user.id, parsed.data.sessionId);
  } catch (err) {
    log.warn("could not resolve picker items", { user_id: user.id }, err);
    return NextResponse.json({ error: "Could not resolve the picker session" }, { status: 502 });
  }
  if (!items) {
    return NextResponse.json({ error: "No selection confirmed yet" }, { status: 409 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "No items were selected" }, { status: 400 });
  }

  const results: IngestResult[] = [];
  for (const item of items) {
    try {
      const body = await downloadPickedItem(provider, user.id, item);
      results.push(
        await ingestPhoto(new File([new Uint8Array(body)], item.name, { type: item.mimeType }), user.id),
      );
    } catch (err) {
      log.warn("google photos import failed for item", { item_id: item.id }, err);
      // Never surface upstream status details to the client.
      results.push({
        status: "failed",
        filename: item.name,
        reason: "Could not download from Google Photos",
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
