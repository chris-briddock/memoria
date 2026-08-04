import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { invites } from "@/db/schema";

// Invite code, carried through the OAuth round-trip in a signed cookie.
//
// The code must survive the redirect to the provider and back, but must not
// appear in the URL (logs, history, referer) and must not be tampered with. A
// short-lived, httpOnly, HMAC-signed cookie satisfies both: the value is the
// code, the signature proves we issued it. `sameSite=lax` lets the cookie ride
// the provider's top-level GET redirect back to our callback.
// ---------------------------------------------------------------------------

const COOKIE_NAME = "memoria_oauth_invite";
const MAX_AGE_SECONDS = 10 * 60; // 10 minutes — plenty for an OAuth round trip

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is required to sign the OAuth invite cookie");
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function encode(code: string): string {
  return `${code}.${sign(code)}`;
}

function decode(raw: string | undefined): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return null;
  const code = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = sign(code);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return code;
}

/** Set the signed invite cookie immediately before redirecting to a provider. */
export async function setOAuthInviteCookie(code: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, encode(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Read (without clearing) the invite code from the signed cookie. */
export async function readOAuthInviteCookie(): Promise<string | null> {
  const store = await cookies();
  return decode(store.get(COOKIE_NAME)?.value);
}

/** Clear the cookie once the invite has been consumed or the flow aborted. */
export async function clearOAuthInviteCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * The single source of truth for "is this invite redeemable right now": a
 * matching code that is unclaimed and unexpired. Shared by the password
 * registration path and the OAuth account-creation gate.
 */
export async function findRedeemableInvite(code: string) {
  if (!code) return null;
  return db.query.invites.findFirst({
    where: and(
      eq(invites.code, code),
      isNull(invites.claimedBy),
      or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
    ),
  });
}

/**
 * Claim an invite for a user, guarding against two people racing the same
 * code: the update is conditional on the invite still being unclaimed, so a
 * loser of the race claims nothing. Returns true if this call won.
 */
export async function claimInvite(inviteId: string, userId: string): Promise<boolean> {
  const claimed = await db
    .update(invites)
    .set({ claimedBy: userId, claimedAt: new Date() })
    .where(and(eq(invites.id, inviteId), isNull(invites.claimedBy)))
    .returning({ id: invites.id });
  return claimed.length > 0;
}
