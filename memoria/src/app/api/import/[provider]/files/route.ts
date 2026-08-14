import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { cloudProvider, isCloudProviderEnabled } from "@/lib/import-providers";
import { listDriveFiles, MAX_PAGE_TOKEN_LEN } from "@/lib/drive/providers";
import { logger } from "@/lib/logger";

const log = logger("api.import.files");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Opaque page-token cap lives in providers.ts so emission and validation
// share one limit: keeps the query string sane and stops abuse.

export async function GET(
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

  const rawToken = new URL(request.url).searchParams.get("pageToken");
  if (rawToken !== null && (rawToken.length === 0 || rawToken.length > MAX_PAGE_TOKEN_LEN)) {
    return NextResponse.json({ error: "Invalid page token" }, { status: 400 });
  }
  const pageToken = rawToken || null;

  try {
    const { files, nextPageToken } = await listDriveFiles(def, user.id, pageToken);
    // Provider thumbnail URLs can't be hot-linked from the browser (Google's
    // thumbnailLink 403s without a session cookie; Microsoft's are long-lived
    // but off-origin). Point each tile at our same-origin proxy, which serves
    // the bytes with the user's OAuth token attached.
    const filesOut = files.map((f) =>
      f.thumbnailUrl
        ? {
            ...f,
            thumbnailUrl: `/api/import/${def.id}/thumb/${encodeURIComponent(f.id)}`,
          }
        : f,
    );
    return NextResponse.json({ files: filesOut, nextPageToken });
  } catch (err) {
    log.warn("drive file listing failed", { provider: def.id, user_id: user.id }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not list files" },
      { status: 502 },
    );
  }
}
