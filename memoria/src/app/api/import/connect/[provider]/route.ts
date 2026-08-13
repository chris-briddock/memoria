import { verifySession } from "@/lib/dal";
import { cloudProvider, isCloudProviderEnabled } from "@/lib/import-providers";
import { setImportConnectCookie } from "@/lib/drive/token";
import { logger } from "@/lib/logger";
import { auth } from "@/auth";

const log = logger("api.import.connect");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a cloud-storage connection: sets a signed cookie binding this flow to
 * the signed-in user, then 302s to the provider's consent screen. Navigation-
 * based (a normal link), never fetch().
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
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Sign in first.", { status: 401 });
  }

  await setImportConnectCookie(def, user.id);

  const url = new URL(def.authorizeUrl);
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/import/callback/${def.id}`;
  const clientId = process.env[def.env.id]!;

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", def.scope);
  // OAuth `state` is defense-in-depth on top of the signed cookie.
  url.searchParams.set("state", user.id);
  for (const [k, v] of Object.entries(def.authorizeExtraParams ?? {})) {
    url.searchParams.set(k, v);
  }

  log.info("starting cloud import connect", { provider: def.id, user_id: user.id });
  return Response.redirect(url.toString(), 302);
}
