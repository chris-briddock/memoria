import { NextResponse } from "next/server";
import { AuthError } from "next-auth";
import { findRedeemableInvite, setOAuthInviteCookie } from "@/lib/oauth";
import { OAUTH_PROVIDERS } from "@/lib/oauth-providers";
import { signIn } from "@/auth";
import { field } from "@/lib/form";
import { logger } from "@/lib/logger";

const log = logger("api.oauth.signin");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start an OAuth sign-in. This is a route handler (not a server action) so
 * the app has zero "use server" modules. It still throws the provider
 * redirect the browser must follow — that redirect is the whole point of the
 * endpoint, so the client must not `fetch()` it but instead submit a normal
 * form GET/POST that lets the browser follow the 302.
 */
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const provider = field(formData, "provider");
  const inviteCode = field(formData, "inviteCode").trim();
  const next = field(formData, "next") || "/";
  const redirectTo = next.startsWith("/") ? next : "/";

  if (provider !== "google") {
    log.warn("oauth sign-in rejected: unknown provider", { provider });
    return NextResponse.json(
      { error: "Unknown sign-in provider." },
      { status: 400 },
    );
  }

  if (!OAUTH_PROVIDERS.find((p) => p.id === provider)?.enabled) {
    // Misconfiguration rather than user error: env vars are missing.
    log.warn("oauth sign-in rejected: provider not configured", { provider });
    return NextResponse.json(
      { error: "Sign-in with Google is not configured on this server yet." },
      { status: 400 },
    );
  }

  if (inviteCode) {
    const invite = await findRedeemableInvite(inviteCode);
    if (!invite) {
      log.info("oauth sign-in rejected: invite not redeemable", { provider });
      return NextResponse.json(
        { error: "That invite code is not valid or has been used." },
        { status: 400 },
      );
    }
    await setOAuthInviteCookie(inviteCode);
  }

  log.info("starting oauth sign-in", {
    provider,
    has_invite: Boolean(inviteCode),
    redirect_path: redirectTo,
  });

  try {
    // signIn() throws the provider redirect; let it propagate.
    await signIn(provider, { redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      log.error("failed to start oauth sign-in", { provider }, error);
      return NextResponse.json(
        { error: "Could not start sign-in with that provider." },
        { status: 500 },
      );
    }
    throw error;
  }
}
