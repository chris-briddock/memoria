import { verifySession } from "@/lib/dal";
import { signIn } from "@/auth";
import type { OAuthProviderId } from "@/lib/oauth-providers";

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
    return new Response("Provider is required.", { status: 400 });
  }

  await verifySession();
  await signIn(provider, { redirectTo: "/settings" });
}
