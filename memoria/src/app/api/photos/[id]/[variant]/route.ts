import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { photos } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { getObjectStream } from "@/lib/storage";
import { logger } from "@/lib/logger";

const log = logger("api.photos.stream");

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

    // Pipe through a transform so we can catch client disconnects and cancel
    // the S3 upstream, rather than letting Next.js throw after we return.
    const stream = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    });
    
    const pipePromise = object.body.pipeTo(stream.writable).catch(() => {
      // Client disconnected — cancel the source stream to stop pulling from S3.
      object.body?.cancel().catch(() => {});
    });
    
    // Don't await — let it stream in background; errors are muted above.
    void pipePromise;

    return new Response(stream.readable, {
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
  } catch (err) {
    // Client disconnected mid-stream (navigation away, tab close). This is
    // expected in e2e and real usage — not an application error.
    const isClientAbort =
      err instanceof Error &&
      (err.message.includes("destination stream closed") ||
        err.message.includes("premature close") ||
        (err as { code?: string }).code === "ERR_STREAM_PREMATURE_CLOSE");
    if (isClientAbort) {
      log.debug("client disconnected during photo stream", { photo_id: id, variant, key });
      return new Response(null, { status: 499 }); // Client Closed Request
    }

    // Storage misses (NoSuchKey) are expected for deleted/missing photos —
    // log at info level, not error which triggers PagerDuty. Only true
    // failures (S3 down, permission denied) merit error level.
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") {
      log.info("photo not found in storage", { photo_id: id, variant, key });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Genuine storage failure (S3 down, network partition, etc.)
    log.error("failed to stream photo object", { photo_id: id, variant, key }, err);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
