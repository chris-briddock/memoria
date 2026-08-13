import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { cloudProvider } from "@/lib/import-providers";
import {
  clearImportConnectCookie,
  exchangeCodeAndSave,
  readImportConnectCookie,
} from "@/lib/drive/token";
import { logger } from "@/lib/logger";

const log = logger("api.import.callback");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generic message shown in the UI; specifics stay in server logs. */
const GENERIC_ERROR = "Connection failed. Please try again.";

function settingsUrl(request: Request, params: Record<string, string>): string {
  const url = new URL("/settings", new URL(request.url).origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await params;
  const def = cloudProvider(providerId);
  if (!def) {
    return NextResponse.redirect(
      settingsUrl(request, { import_error: "Unknown import provider" }),
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  try {
    // Single session source; must be the same browser session that started
    // the flow (verifySession redirects anonymous visitors to /signin).
    const user = await verifySession();
    const cookiePayload = await readImportConnectCookie(def);
    await clearImportConnectCookie(def);

    if (error) {
      log.info("cloud import connect denied at provider", { provider: def.id, error });
      return NextResponse.redirect(
        settingsUrl(request, { import_error: `${def.label} connection was denied` }),
      );
    }
    if (!cookiePayload) {
      return NextResponse.redirect(
        settingsUrl(request, { import_error: "Connection flow expired — try again" }),
      );
    }
    const [cookieUserId, cookieState] = cookiePayload.split(":");
    if (cookieUserId !== user.id || !state || state !== cookieState) {
      log.warn("cloud import callback session mismatch", { provider: def.id });
      return NextResponse.redirect(
        settingsUrl(request, { import_error: "Connection flow mismatch — try again" }),
      );
    }
    if (!code) {
      log.warn("cloud import callback missing code", { provider: def.id, user_id: user.id });
      return NextResponse.redirect(settingsUrl(request, { import_error: GENERIC_ERROR }));
    }

    const redirectUri = `${new URL(request.url).origin}/api/import/callback/${def.id}`;
    const result = await exchangeCodeAndSave(def, code, user.id, redirectUri);
    if (!result.connected) {
      // The detailed reason is logged server-side; never echoed back to the
      // browser where it could leak provider responses or internals.
      log.warn("cloud import connect failed", { provider: def.id, reason: result.reason });
      return NextResponse.redirect(settingsUrl(request, { import_error: GENERIC_ERROR }));
    }

    log.info("cloud import connected", { provider: def.id, user_id: user.id });
    return NextResponse.redirect(settingsUrl(request, { import_connected: def.id }));
  } catch (err) {
    log.error("cloud import callback error", { provider: def.id }, err);
    return NextResponse.redirect(settingsUrl(request, { import_error: GENERIC_ERROR }));
  }
}
