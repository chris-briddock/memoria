import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { cloudProvider, isCloudProviderEnabled } from "@/lib/import-providers";
import {
  createPickerSession,
  pollPickerSession,
  type PickedItem,
} from "@/lib/drive/google-photos";
import { logger } from "@/lib/logger";

const log = logger("api.google-photos.files");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST: create a Picker session -> { pickerUri, sessionId }. The client then
 * navigates the user to pickerUri in a new tab.
 */
export async function POST() {
  const user = await verifySession();
  const def = cloudProvider("gdrive");
  if (!def || !isCloudProviderEnabled(def)) {
    return NextResponse.json(
      { error: "Google import is not configured on this server" },
      { status: 400 },
    );
  }
  try {
    const session = await createPickerSession(def, user.id);
    return NextResponse.json(session);
  } catch (err) {
    log.warn("picker session create failed", { user_id: user.id }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start picker" },
      { status: 502 },
    );
  }
}

/**
 * GET ?sessionId=... -> { done: false } | { done: true, items: PickedItem[] }.
 * Polled by the /import page after the picker tab opens.
 */
export async function GET(request: Request) {
  const user = await verifySession();
  const def = cloudProvider("gdrive");
  if (!def || !isCloudProviderEnabled(def)) {
    return NextResponse.json(
      { error: "Google import is not configured on this server" },
      { status: 400 },
    );
  }
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  try {
    const items: PickedItem[] | null = await pollPickerSession(def, user.id, sessionId);
    if (items === null) return NextResponse.json({ done: false });
    return NextResponse.json({ done: true, items });
  } catch (err) {
    log.warn("picker session poll failed", { user_id: user.id }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not poll picker" },
      { status: 502 },
    );
  }
}
