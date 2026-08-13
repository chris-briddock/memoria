import { randomUUID } from "node:crypto";
import { verifySession } from "@/lib/dal";
import { cloudProvider, isCloudProviderEnabled } from "@/lib/import-providers";
import { setImportConnectCookie } from "@/lib/drive/token";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("api.import.connect");

/**
 * Start a cloud-storage connection: sets a signed cookie binding this flow to
 * the signed-in user (plus a random nonce), then 302s to the provider's
 * consent screen. Navigation-based (a normal link), never fetch().
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await params;
  const def = cloudProvider(providerId);
  if (!def) {
    return new Response("Unknown import provider.", { status: 400 });
  }
  if (!isCloudProviderEnabled(def)) {
    return new Response(`${def.label} import is not configured on this server.`, {
      status: 400,
    });
  }

  const user = await verifySession();

  // OAuth `state` is an unguessable nonce round-tripped through the signed
  // cookie — never the (predictable) user id.
  const state = randomUUID();
  await setImportConnectCookie(def, `${user.id}:${state}`);

  const url = new URL(def.authorizeUrl);
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/import/callback/${def.id}`;
  const clientId = process.env[def.env.id]!;

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", def.scope);
  url.searchParams.set("state", state);
  for (const [k, v] of Object.entries(def.authorizeExtraParams ?? {})) {
    url.searchParams.set(k, v);
  }

  log.info("starting cloud import connect", { provider: def.id, user_id: user.id });
  return Response.redirect(url.toString(), 302);
}
