import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import {
  cloudProviderCredentials,
  type CloudProviderDef,
} from "@/lib/import-providers";

/**
 * The connect flow round-trips through a signed cookie.
 * The cookie's value is the JWT-like `payload.signature` where payload is
 * `${userId}:${issuedAtMs}`, so tampering is rejected and the callback can
 * confirm the same browser session both started and finished the flow.
 */

const COOKIE_PREFIX = "memoria_import_";
const MAX_AGE_SECONDS = 10 * 60; // 10 minutes

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is required to sign the import cookie");
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function encode(payload: string): string {
  return `${payload}.${sign(payload)}`;
}

function decode(raw: string | undefined): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

function cookieName(provider: CloudProviderDef): string {
  return `${COOKIE_PREFIX}${provider.id}`;
}

export async function setImportConnectCookie(
  provider: CloudProviderDef,
  userId: string,
): Promise<void> {
  const store = await cookies();
  store.set(cookieName(provider), encode(`${userId}:${Date.now()}`), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Returns the payload `${userId}:${issuedAtMs}` when valid, else null. */
export async function readImportConnectCookie(
  provider: CloudProviderDef,
): Promise<string | null> {
  const store = await cookies();
  return decode(store.get(cookieName(provider))?.value);
}

export async function clearImportConnectCookie(
  provider: CloudProviderDef,
): Promise<void> {
  const store = await cookies();
  store.delete(cookieName(provider));
}

// ---------------------------------------------------------------------------

const REFRESH_SKEW_MS = 60 * 1000; // refresh 60s early so in-flight requests never 401

type TokenRow = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
};

async function readAccount(
  provider: CloudProviderDef,
  userId: string,
): Promise<(TokenRow & { providerAccountId: string }) | null> {
  const row = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, provider.id)),
  });
  if (!row) return null;
  return {
    providerAccountId: row.providerAccountId,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
  };
}

async function refreshToken(
  provider: CloudProviderDef,
  refreshTokenValue: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const creds = cloudProviderCredentials(provider);
  if (!creds) {
    throw new Error(`${provider.label} import is not configured on this server`);
  }

  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: refreshTokenValue,
    grant_type: "refresh_token",
    ...provider.tokenExtraBody,
  });

  const res = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type":
        provider.tokenContentType === "form"
          ? "application/x-www-form-urlencoded"
          : "application/json",
    },
    body:
      provider.tokenContentType === "form"
        ? body
        : JSON.stringify(Object.fromEntries(body)),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Could not refresh ${provider.label} token (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error(`${provider.label} refresh response missing access_token`);
  }

  return {
    accessToken: json.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600),
  };
}

/**
 * Returns an access token valid for at least `REFRESH_SKEW_MS`. Refreshes
 * transparently and persists the new token back to the account row —
 * callers don't need to think about expiry.
 */
export async function getValidAccessToken(
  provider: CloudProviderDef,
  userId: string,
): Promise<string> {
  const account = await readAccount(provider, userId);
  if (!account) {
    throw new Error(`No ${provider.label} connection found. Connect it from Settings.`);
  }
  if (!account.accessToken) {
    throw new Error(`${provider.label} connection has no access token. Reconnect it.`);
  }

  const expiresAtMs = account.expiresAt ? account.expiresAt * 1000 : 0;
  const stillValid = expiresAtMs - Date.now() > REFRESH_SKEW_MS;
  if (stillValid) return account.accessToken;

  if (!account.refreshToken) {
    throw new Error(
      `${provider.label} access token expired and there is no refresh token. Reconnect from Settings.`,
    );
  }

  const refreshed = await refreshToken(provider, account.refreshToken);
  await db
    .update(accounts)
    .set({ access_token: refreshed.accessToken, expires_at: refreshed.expiresAt })
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.provider, provider.id),
        eq(accounts.providerAccountId, account.providerAccountId),
      ),
    );
  return refreshed.accessToken;
}

/** Exchange the OAuth authorization code for tokens and persist the account. */
export async function exchangeCodeAndSave(
  provider: CloudProviderDef,
  code: string,
  userId: string,
  redirectUri: string,
): Promise<{ connected: true } | { connected: false; reason: string }> {
  const creds = cloudProviderCredentials(provider);
  if (!creds) return { connected: false, reason: `${provider.label} is not configured on this server` };

  const params = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const res = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      connected: false,
      reason: `Token exchange failed (${res.status}): ${text.slice(0, 200)}`,
    };
  }

  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    return { connected: false, reason: "Token response missing access_token" };
  }

  // Microsoft returns no refresh_token if offline_access wasn't requested;
  // Google does the same unless access_type=offline&prompt=consent. We could
  // still save the connection (short-lived access), but we choose to surface
  // this as a configuration problem since imports will break within an hour.
  if (!json.refresh_token) {
    return {
      connected: false,
      reason: `No refresh token returned by ${provider.label}. Ensure the OAuth consent grants offline access.`,
    };
  }

  const expiresAt = Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600);

  // We must identify the remote account for the accounts-table composite PK.
  // Drive: GET https://www.googleapis.com/drive/v3/about?fields=user. Graph: /me.
  const externalId = await fetchExternalAccountId(provider, json.access_token);

  await db
    .insert(accounts)
    .values({
      userId,
      type: "oauth",
      provider: provider.id,
      providerAccountId: externalId,
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: expiresAt,
      token_type: "Bearer",
      scope: provider.scope,
    })
    .onConflictDoUpdate({
      target: [accounts.provider, accounts.providerAccountId],
      set: {
        userId,
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: expiresAt,
        scope: provider.scope,
      },
    });

  return { connected: true };
}

async function fetchExternalAccountId(
  provider: CloudProviderDef,
  accessToken: string,
): Promise<string> {
  const url =
    provider.id === "gdrive"
      ? "https://www.googleapis.com/drive/v3/about?fields=user"
      : "https://graph.microsoft.com/v1.0/me?$select=id";
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Could not resolve ${provider.label} account id (${res.status})`);
  }
  const json = (await res.json()) as
    | { user?: { permissionId?: string; emailAddress?: string } }
    | { id?: string };
  const id =
    provider.id === "gdrive"
      ? (json as { user?: { permissionId?: string; emailAddress?: string } }).user?.permissionId ??
        (json as { user?: { emailAddress?: string } }).user?.emailAddress
      : (json as { id?: string }).id;
  if (!id) throw new Error(`${provider.label} account id missing from response`);
  return id;
}
