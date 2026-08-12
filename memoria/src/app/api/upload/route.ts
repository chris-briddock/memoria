import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { verifySession } from "@/lib/dal";
import { ingestPhoto, type IngestResult } from "@/lib/ingest";
import { logger } from "@/lib/logger";

const log = logger("api.upload");
const tracer = trace.getTracer("memoria.server");

// Uploads are buffered and processed with sharp, so this must run on Node.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await verifySession();

  const formData = await request.formData();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files were uploaded" }, { status: 400 });
  }

  const results: IngestResult[] = [];
  // Sequential: each file already saturates CPU during resize, and this keeps
  // peak memory bounded to one image at a time.
  for (const file of files) {
    try {
      results.push(
        await tracer.startActiveSpan("ingestPhoto", async (span) => {
          span.setAttributes({
            "upload.filename": file.name || "untitled",
            "upload.size_bytes": file.size,
            "upload.content_type": file.type,
            "enduser.id": user.id,
          });
          try {
            return await ingestPhoto(file, user.id);
          } catch (err) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : "Upload failed",
            });
            span.recordException(err instanceof Error ? err : new Error(String(err)));
            throw err;
          } finally {
            span.end();
          }
        }),
      );
    } catch (err) {
      log.error(
        "photo ingest failed",
        { filename: file.name || "untitled", size_bytes: file.size, user_id: user.id },
        err,
      );
      results.push({
        status: "failed",
        filename: file.name || "untitled",
        reason: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  if (results.some((r) => r.status === "created")) {
    revalidatePath("/");
  }

  return NextResponse.json({
    results,
    created: results.filter((r) => r.status === "created").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    failed: results.filter((r) => r.status === "failed").length,
  });
}
