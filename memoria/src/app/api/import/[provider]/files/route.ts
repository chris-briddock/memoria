import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { cloudProvider, isCloudProviderEnabled } from "@/lib/import-providers";
import { listDriveFiles } from "@/lib/drive/providers";
import { logger } from "@/lib/logger";

const log = logger("api.import.files");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _request: Request,
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

  try {
    const files = await listDriveFiles(def, user.id);
    return NextResponse.json({ files });
  } catch (err) {
    log.warn("drive file listing failed", { provider: def.id, user_id: user.id }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not list files" },
      { status: 502 },
    );
  }
}
