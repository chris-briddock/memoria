import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { ingestPhoto, type IngestResult } from "@/lib/ingest";

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
      results.push(await ingestPhoto(file, user.id));
    } catch (err) {
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
