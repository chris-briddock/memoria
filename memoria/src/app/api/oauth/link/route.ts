import { verifySession } from "@/lib/dal";
import { signIn } from "@/auth";
import type { OAuthProviderId } from "@/lib/oauth-providers";
import { logger } from "@/lib/logger";

const log = logger("api.oauth.link");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Link an OAuth provider to the current account. The user is already signed
 * in; Auth.js's handle-login links an unlinked OAuth identity to the active
 * session automatically. This route just starts that redirect back to the
 * settings page — it must be navigation-based (a normal link), not fetch().
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") as OAuthProviderId | null;
  if (!provider) {
    log.warn("oauth link rejected: provider missing");
    return new Response("Provider is required.", { status: 400 });
  }

  const user = await verifySession();
  log.info("starting oauth account link", { provider, user_id: user.id });
  await signIn(provider, { redirectTo: "/settings" });
}
