import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { cloudProvider, isCloudProviderEnabled } from "@/lib/import-providers";
import { fetchDriveThumbnail } from "@/lib/drive/providers";
import { logger } from "@/lib/logger";

const log = logger("api.import.thumb");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Guard against unbounded proxy targets. */
const MAX_FILE_ID_LEN = 128;
/** Allow browsers to cache thumbnails briefly; import grids re-request often. */
const CACHE_CONTROL = "private, max-age=300";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string; fileId: string }> },
) {
  const user = await verifySession();
  const { provider: providerId, fileId } = await params;
  const def = cloudProvider(providerId);
  if (!def) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  if (!isCloudProviderEnabled(def)) {
    return NextResponse.json(
      { error: `${def.label} import is not configured on this server` },
      { status: 400 },
    );
  }
  if (!fileId || fileId.length > MAX_FILE_ID_LEN) {
    return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  }

  try {
    const { body, contentType } = await fetchDriveThumbnail(def, user.id, fileId);
    return new NextResponse(Buffer.from(body), {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL },
    });
  } catch (err) {
    log.warn(
      "thumbnail fetch failed",
      { provider: def.id, user_id: user.id, file_id: fileId },
      err,
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not fetch thumbnail" },
      { status: 502 },
    );
  }
}
