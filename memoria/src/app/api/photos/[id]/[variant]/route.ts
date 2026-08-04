import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { photos } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { getObjectStream } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * The bucket is private, so image bytes are streamed through here behind a
 * session check rather than exposed via public or presigned URLs.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variant: string }> },
) {
  await verifySession();

  const { id, variant } = await params;
  if (variant !== "thumb" && variant !== "orig") {
    return NextResponse.json({ error: "Unknown variant" }, { status: 404 });
  }

  const photo = await db.query.photos.findFirst({ where: eq(photos.id, id) });
  if (!photo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key = variant === "thumb" ? photo.thumbKey : photo.storageKey;

  try {
    const object = await getObjectStream(key);
    if (!object.body) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        "Content-Type":
          object.contentType ?? (variant === "thumb" ? "image/webp" : photo.mimeType),
        // Content is immutable per id+variant (keys are content-addressed),
        // but must stay out of shared caches since it is access-controlled.
        "Cache-Control": "private, max-age=31536000, immutable",
        ...(object.contentLength
          ? { "Content-Length": String(object.contentLength) }
          : {}),
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
