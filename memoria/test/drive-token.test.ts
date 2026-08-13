import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * drive/token.ts touches three boundaries: next/headers cookies, the drizzle
 * db, and fetch() (OAuth token endpoints). All three are mocked; the module
 * is re-imported fresh per test because nothing is cached at module scope,
 * but this keeps isolation airtight.
 */

const { dbState, cookiesState } = vi.hoisted(() => {
  return {
    dbState: {
      account: null as null | {
        userId: string;
        provider: string;
        providerAccountId: string;
        access_token: string | null;
        refresh_token: string | null;
        expires_at: number | null;
      },
      updated: [] as Array<Record<string, unknown>>,
      inserted: [] as Array<Record<string, unknown>>,
    },
    cookiesState: {
      jar: new Map<string, string>(),
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookiesState.jar.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string) => {
      cookiesState.jar.set(name, value);
    },
    delete: (name: string) => {
      cookiesState.jar.delete(name);
    },
  }),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      accounts: {
        findFirst: async () => dbState.account,
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          dbState.updated.push(values);
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          dbState.inserted.push(values);
        },
      }),
    }),
  },
}));

import { cloudProvider } from "@/lib/import-providers";
import {
  clearImportConnectCookie,
  exchangeCodeAndSave,
  getValidAccessToken,
  readImportConnectCookie,
  setImportConnectCookie,
} from "@/lib/drive/token";

const gdrive = cloudProvider("gdrive")!;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function accountWith(overrides: Partial<NonNullable<typeof dbState.account>>) {
  dbState.account = {
    userId: "user-1",
    provider: "gdrive",
    providerAccountId: "ext-1",
    access_token: "t",
    refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret";
  process.env.IMPORT_GOOGLE_CLIENT_ID = "client-id";
  process.env.IMPORT_GOOGLE_CLIENT_SECRET = "client-secret";
  dbState.account = null;
  dbState.updated = [];
  dbState.inserted = [];
  cookiesState.jar.clear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  delete process.env.IMPORT_GOOGLE_CLIENT_ID;
  delete process.env.IMPORT_GOOGLE_CLIENT_SECRET;
  delete process.env.IMPORT_MICROSOFT_CLIENT_ID;
  delete process.env.IMPORT_MICROSOFT_CLIENT_SECRET;
  vi.unstubAllGlobals();
});

describe("connect cookie", () => {
  it("round-trips a signed payload binding the flow to the user", async () => {
    await setImportConnectCookie(gdrive, "user-1");
    const payload = await readImportConnectCookie(gdrive);
    expect(payload).not.toBeNull();
    expect(payload!.split(":")[0]).toBe("user-1");
  });

  it("keeps providers in separate jars so two connect flows don't collide", async () => {
    await setImportConnectCookie(gdrive, "user-1");
    expect(await readImportConnectCookie(cloudProvider("onedrive")!)).toBeNull();
  });

  it("rejects tampered cookie values", async () => {
    await setImportConnectCookie(gdrive, "user-1");
    const name = "memoria_import_gdrive";
    cookiesState.jar.set(name, `${cookiesState.jar.get(name)}tampered`);
    expect(await readImportConnectCookie(gdrive)).toBeNull();
  });

  it("round-trips the connect flow payload with a state nonce", async () => {
    // The connect route stores `${userId}:${uuid-state}`; setImportConnectCookie
    // appends the timestamp. decode must read the trailing segment as the
    // timestamp, not mistake the uuid for it.
    await setImportConnectCookie(gdrive, "user-1:nonce-123");
    const payload = await readImportConnectCookie(gdrive);
    expect(payload).not.toBeNull();
    const [cookieUserId, cookieState] = payload!.split(":");
    expect(cookieUserId).toBe("user-1");
    expect(cookieState).toBe("nonce-123");
  });

  it("rejects a payload with a non-numeric timestamp", async () => {
    // Payload without a numeric trailing timestamp must fail decode.
    await setImportConnectCookie(gdrive, "user-1");
    const name = "memoria_import_gdrive";
    // Overwrite with a payload whose last segment is not a number, re-signed.
    const { createHmac } = await import("node:crypto");
    const bogus = "user-1:not-a-number";
    const sig = createHmac("sha256", "test-secret").update(bogus).digest("base64url");
    cookiesState.jar.set(name, `${bogus}.${sig}`);
    expect(await readImportConnectCookie(gdrive)).toBeNull();
  });

  it("clear removes the cookie", async () => {
    await setImportConnectCookie(gdrive, "user-1");
    await clearImportConnectCookie(gdrive);
    expect(await readImportConnectCookie(gdrive)).toBeNull();
  });
});

describe("getValidAccessToken", () => {
  it("errors when no connection exists", async () => {
    await expect(getValidAccessToken(gdrive, "user-1")).rejects.toThrow(/No Google Drive connection/);
  });

  it("returns a fresh-enough token without refreshing", async () => {
    dbState.account = {
      userId: "user-1",
      provider: "gdrive",
      providerAccountId: "ext-1",
      access_token: "good-token",
      refresh_token: "refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    await expect(getValidAccessToken(gdrive, "user-1")).resolves.toBe("good-token");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the new one", async () => {
    dbState.account = {
      userId: "user-1",
      provider: "gdrive",
      providerAccountId: "ext-1",
      access_token: "expired",
      refresh_token: "refresh-value",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "fresh-token", expires_in: 7200 }),
    );

    await expect(getValidAccessToken(gdrive, "user-1")).resolves.toBe("fresh-token");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = init?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-value");
    expect(body.get("client_id")).toBe("client-id");

    expect(dbState.updated).toHaveLength(1);
    expect(dbState.updated[0].access_token).toBe("fresh-token");
  });

  it("treats tokens expiring within the skew window as stale", async () => {
    dbState.account = {
      userId: "user-1",
      provider: "gdrive",
      providerAccountId: "ext-1",
      access_token: "nearly-stale",
      refresh_token: "refresh-value",
      expires_at: Math.floor(Date.now() / 1000) + 30, // inside the 60s skew
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "refreshed", expires_in: 3600 }),
    );
    await expect(getValidAccessToken(gdrive, "user-1")).resolves.toBe("refreshed");
  });

  it("surfaces a clear message when expiry passes with no refresh token", async () => {
    dbState.account = {
      userId: "user-1",
      provider: "gdrive",
      providerAccountId: "ext-1",
      access_token: "expired",
      refresh_token: null,
      expires_at: Math.floor(Date.now() / 1000) - 10,
    };
    await expect(getValidAccessToken(gdrive, "user-1")).rejects.toThrow(/no refresh token/);
  });

  it("treats a missing expires_at as stale and refreshes", async () => {
    accountWith({ expires_at: null });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "back", expires_in: 3600 }),
    );
    await expect(getValidAccessToken(gdrive, "user-1")).resolves.toBe("back");
  });

  it("persists a rotated refresh token when the provider returns one", async () => {
    accountWith({ expires_at: Math.floor(Date.now() / 1000) - 1 });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "new-at", expires_in: 3600, refresh_token: "new-rt" }),
    );

    const token = await getValidAccessToken(gdrive, "user-1");
    expect(token).toBe("new-at");
    expect(dbState.updated[0].refresh_token).toBe("new-rt");
  });

  it("keeps the existing refresh token when the refresh response omits one", async () => {
    accountWith({ expires_at: Math.floor(Date.now() / 1000) - 1 });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "new-at", expires_in: 3600 }),
    );

    const token = await getValidAccessToken(gdrive, "user-1");
    expect(token).toBe("new-at");
    expect(dbState.updated[0].refresh_token).toBeUndefined();
  });

  it("uses a 1-hour default when the refresh response omits expires_in", async () => {
    accountWith({ expires_at: Math.floor(Date.now() / 1000) - 5 });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ access_token: "t2" }));
    await expect(getValidAccessToken(gdrive, "user-1")).resolves.toBe("t2");
    expect(dbState.updated[0].expires_at).toBeGreaterThan(
      Math.floor(Date.now() / 1000) + 3000,
    );
  });

  it("fails to refresh when server credentials were removed mid-flight", async () => {
    // Account row says the user connected, but the env vars are gone now.
    accountWith({ expires_at: Math.floor(Date.now() / 1000) - 5 });
    delete process.env.IMPORT_GOOGLE_CLIENT_ID;
    await expect(getValidAccessToken(gdrive, "user-1")).rejects.toThrow(
      /import is not configured on this server/,
    );
  });

  it("rejects a refresh response without an access_token", async () => {
    accountWith({ expires_at: Math.floor(Date.now() / 1000) - 5 });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));
    await expect(getValidAccessToken(gdrive, "user-1")).rejects.toThrow(
      /refresh response missing access_token/,
    );
  });

  it("errors when an account row exists but has no access token", async () => {
    accountWith({ access_token: null });
    await expect(getValidAccessToken(gdrive, "user-1")).rejects.toThrow(/no access token/);
  });

  it("errors when refresh itself fails", async () => {
    dbState.account = {
      userId: "user-1",
      provider: "gdrive",
      providerAccountId: "ext-1",
      access_token: "expired",
      refresh_token: "refresh-value",
      expires_at: Math.floor(Date.now() / 1000) - 10,
    };
    vi.mocked(fetch).mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }));
    await expect(getValidAccessToken(gdrive, "user-1")).rejects.toThrow(
      /Could not refresh Google Drive token \(400\)/,
    );
  });
});

describe("exchangeCodeAndSave", () => {
  const meta = { user: { permissionId: "perm-123" } };

  it("falls back to the Drive emailAddress as external id when permissionId is absent", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "at", refresh_token: "rt" }))
      .mockResolvedValueOnce(jsonResponse({ user: { emailAddress: "a@b.c" } }));
    const result = await exchangeCodeAndSave(gdrive, "c", "user-1", "http://x");
    expect(result.connected).toBe(true);
    expect(dbState.inserted[0].providerAccountId).toBe("a@b.c");
  });

  it("reports a token response that is missing access_token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ refresh_token: "rt" }));
    const result = await exchangeCodeAndSave(gdrive, "code", "user-1", "http://x");
    expect(result.connected).toBe(false);
    if (!result.connected) expect(result.reason).toMatch(/missing access_token/);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("rejects an account-id response with no usable identifier", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "at", refresh_token: "rt" }))
      .mockResolvedValueOnce(jsonResponse({}));
    await expect(exchangeCodeAndSave(gdrive, "c", "user-1", "http://x")).rejects.toThrow(
      /account id missing/,
    );
  });

  it("exchanges the code, resolves the remote account id, and upserts tokens", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(jsonResponse(meta));

    const result = await exchangeCodeAndSave(
      gdrive,
      "auth-code",
      "user-1",
      "http://localhost:3000/api/import/callback/gdrive",
    );

    expect(result.connected).toBe(true);

    const [tokenUrl, tokenInit] = vi.mocked(fetch).mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    const body = tokenInit?.body as URLSearchParams;
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe("http://localhost:3000/api/import/callback/gdrive");

    // gdrive external id is the Drive permissionId
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("drive/v3/about");

    expect(dbState.inserted).toHaveLength(1);
    const saved = dbState.inserted[0];
    expect(saved.provider).toBe("gdrive");
    expect(saved.providerAccountId).toBe("perm-123");
    expect(saved.access_token).toBe("at");
    expect(saved.refresh_token).toBe("rt");
    expect(saved.userId).toBe("user-1");
  });

  it("resolves the OneDrive account id from /me", async () => {
    process.env.IMPORT_MICROSOFT_CLIENT_ID = "ms-id";
    process.env.IMPORT_MICROSOFT_CLIENT_SECRET = "ms-secret";
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "ms-user-9" }));

    const onedrive = cloudProvider("onedrive")!;
    const result = await exchangeCodeAndSave(
      onedrive,
      "code",
      "user-1",
      "http://localhost:3000/api/import/callback/onedrive",
    );

    expect(result.connected).toBe(true);
    expect(dbState.inserted[0].providerAccountId).toBe("ms-user-9");
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("graph.microsoft.com/v1.0/me");
  });

  it("refuses to save a connection without a refresh token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "at", expires_in: 3600 }),
    );
    const result = await exchangeCodeAndSave(gdrive, "code", "user-1", "http://x");
    expect(result.connected).toBe(false);
    if (!result.connected) expect(result.reason).toMatch(/No refresh token/);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("reports token exchange failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("bad code", { status: 401 }));
    const result = await exchangeCodeAndSave(gdrive, "code", "user-1", "http://x");
    expect(result.connected).toBe(false);
    if (!result.connected) expect(result.reason).toMatch(/Token exchange failed \(401\)/);
  });

  it("fails fast when the provider is not configured", async () => {
    delete process.env.IMPORT_GOOGLE_CLIENT_ID;
    const result = await exchangeCodeAndSave(gdrive, "code", "user-1", "http://x");
    expect(result.connected).toBe(false);
  });
});
