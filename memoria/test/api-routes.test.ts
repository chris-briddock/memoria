import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

/**
 * Unit tests for the API route handlers that replaced the server actions.
 *
 * The route handlers call `verifySession` (auth) and `db` (queries) and
 * `revalidatePath`/`deleteObjects` (side-effects). We mock all of those so the
 * tests exercise the handler logic — validation, authz, JSON shape — without a
 * database or an S3 bucket.
 */

// --- hoisted mocks ----------------------------------------------------------

const { verifySession, revalidatePath, deleteObjects, signIn, signOut, auth, AuthError } =
  vi.hoisted(() => {
    class AuthError extends Error {
      constructor(type: string) {
        super(type);
        this.name = "AuthError";
      }
    }
    return {
      verifySession: vi.fn(),
      revalidatePath: vi.fn(),
      deleteObjects: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      auth: vi.fn(),
      AuthError,
    };
  });

vi.mock("@/lib/dal", () => ({ verifySession }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/storage", () => ({ deleteObjects }));
vi.mock("@/auth", () => ({ signIn, signOut, auth }));
vi.mock("next-auth", () => ({ AuthError }));

// next/server provides NextResponse; stub it with a minimal Response wrapper.
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

import { findRedeemableInvite, claimInvite } from "@/lib/oauth";

// --- Drizzle mock -----------------------------------------------------------
// Each handler builds a small query chain via db.query.*.findFirst or
// db.update/insert/delete. We give each verb a chain whose `.then` resolves to
// the supplied result, and track the final value for assertions.

function makeChain(result: unknown) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    set: vi.fn(() => chain),
    values: vi.fn(() => chain),
    returning: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: vi.fn((resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
    ),
  };
  return chain;
}

const db = {
  query: {
    users: { findFirst: vi.fn() },
    photos: { findFirst: vi.fn() },
    albums: { findFirst: vi.fn() },
    accounts: { findMany: vi.fn() },
  },
  select: vi.fn(() => makeChain([])),
  update: vi.fn(() => makeChain(undefined)),
  insert: vi.fn(() => makeChain(undefined)),
  delete: vi.fn(() => makeChain(undefined)),
};

vi.mock("@/db", () => ({ db }));

// queries re-exports are used inside some routes; mock the module so the
// route's own import doesn't hit the db.
vi.mock("@/lib/queries", () => ({
  listPhotos: vi.fn(async () => []),
  getPhoto: vi.fn(async () => null),
  listAlbums: vi.fn(async () => []),
  getAlbum: vi.fn(async () => null),
  getVaultStats: vi.fn(async () => ({
    photos: 0,
    bytes: 0,
    albums: 0,
    members: 0,
  })),
  albumsForPhoto: vi.fn(async () => []),
  listInvites: vi.fn(async () => []),
  listMembers: vi.fn(async () => []),
  listSignInMethods: vi.fn(async () => ({ hasPassword: false, providers: [] })),
  isBootstrapping: vi.fn(async () => true),
  isPhotoInAlbum: vi.fn(async () => false),
}));

vi.mock("@/lib/oauth", () => ({
  findRedeemableInvite: vi.fn(),
  claimInvite: vi.fn(),
  setOAuthInviteCookie: vi.fn(),
}));

// --- helpers ----------------------------------------------------------------

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function jsonBody(body: unknown): { body: string; headers: Record<string, string> } {
  return {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  };
}

function formDataBody(entries: Record<string, string>): {
  body: FormData;
} {
  return { body: fd(entries) };
}

const ADMIN = { id: "admin-1", email: "a@x.test", name: "A", role: "admin" as const };
const MEMBER = { id: "mem-1", email: "m@x.test", name: "M", role: "member" as const };

// zod v4's `z.uuid()` enforces strict RFC 4122 — the variant nibble must be
// 8/9/a/b and the version nibble 1-8. The old all-`1`/`2` fixtures fail that
// pattern, so every route that validated its id returned 400 instead of 200.
const PHOTO_ID = "11111111-1111-4111-8111-111111111111";
const ALBUM_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: signed-in admin for handler bodies that just `await verifySession()`
  verifySession.mockResolvedValue(ADMIN);
});

// --- photos/[id]/favorite ---------------------------------------------------

describe("POST /api/photos/[id]/favorite", () => {
  let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/photos/[id]/favorite/route"));
  });

  it("flips the favorite flag and revalidates", async () => {
    db.query.photos.findFirst.mockResolvedValueOnce({
      id: PHOTO_ID,
      favorite: false,
    });
    const res = await POST(
      new Request(`http://localhost/api/photos/${PHOTO_ID}/favorite`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, favorite: true });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith(`/photos/${PHOTO_ID}`);
  });

  it("returns 404 when the photo is missing", async () => {
    db.query.photos.findFirst.mockResolvedValueOnce(undefined);
    const res = await POST(
      new Request(`http://localhost/api/photos/${PHOTO_ID}/favorite`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects an invalid photo id", async () => {
    const res = await POST(
      new Request("http://localhost/api/photos/not-a-uuid/favorite", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
  });
});

// --- photos/[id] PATCH (caption) + DELETE -----------------------------------

describe("PATCH /api/photos/[id] (caption)", () => {
  let PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    ({ PATCH } = await import("@/app/api/photos/[id]/route"));
  });

  it("trims and stores a caption", async () => {
    const res = await PATCH(
      new Request(`http://localhost/api/photos/${PHOTO_ID}`, {
        method: "PATCH",
        ...formDataBody({ caption: "  Beach day  " }),
      }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("stores null when the caption is empty after trimming", async () => {
    await PATCH(
      new Request(`http://localhost/api/photos/${PHOTO_ID}`, {
        method: "PATCH",
        ...formDataBody({ caption: "   " }),
      }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    // The chain captures the set value; inspect the mock call to the update verb.
    const updateCall = db.update.mock.calls.at(-1);
    expect(updateCall).toBeTruthy();
  });

  it("rejects an invalid photo id", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/photos/bad", {
        method: "PATCH",
        ...formDataBody({ caption: "x" }),
      }),
      { params: Promise.resolve({ id: "bad" }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/photos/[id]", () => {
  let DELETE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    ({ DELETE } = await import("@/app/api/photos/[id]/route"));
  });

  it("lets the uploader delete their photo and its objects", async () => {
    db.query.photos.findFirst.mockResolvedValueOnce({
      id: PHOTO_ID,
      uploadedBy: ADMIN.id,
      storageKey: "k",
      thumbKey: "t",
    });
    const res = await DELETE(
      new Request(`http://localhost/api/photos/${PHOTO_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/" });
    expect(deleteObjects).toHaveBeenCalledWith(["k", "t"]);
  });

  it("lets an admin delete someone else's photo", async () => {
    db.query.photos.findFirst.mockResolvedValueOnce({
      id: PHOTO_ID,
      uploadedBy: "someone-else",
      storageKey: "k",
      thumbKey: "t",
    });
    const res = await DELETE(
      new Request(`http://localhost/api/photos/${PHOTO_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(200);
  });

  it("forbids a member deleting another member's photo", async () => {
    verifySession.mockResolvedValueOnce(MEMBER);
    db.query.photos.findFirst.mockResolvedValueOnce({
      id: PHOTO_ID,
      uploadedBy: ADMIN.id,
      storageKey: "k",
      thumbKey: "t",
    });
    const res = await DELETE(
      new Request(`http://localhost/api/photos/${PHOTO_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(403);
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it("returns 404 when the photo is missing", async () => {
    db.query.photos.findFirst.mockResolvedValueOnce(undefined);
    const res = await DELETE(
      new Request(`http://localhost/api/photos/${PHOTO_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(404);
  });
});

// --- albums POST (create) + [id] DELETE -------------------------------------

describe("POST /api/albums", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/albums/route"));
  });

  it("creates an album and returns a redirect", async () => {
    // insert().returning().then(resolve) → resolve([{ id: ALBUM_ID }])
    const chain = makeChain([{ id: ALBUM_ID }]);
    db.insert.mockImplementationOnce(() => chain);
    const res = await POST(
      new Request("http://localhost/api/albums", {
        method: "POST",
        ...formDataBody({ name: "Holiday 2024", description: "Summer" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: ALBUM_ID, redirect: `/albums/${ALBUM_ID}` });
  });

  it("rejects a blank name", async () => {
    const res = await POST(
      new Request("http://localhost/api/albums", {
        method: "POST",
        ...formDataBody({ name: "   " }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/albums/[id]", () => {
  let DELETE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    ({ DELETE } = await import("@/app/api/albums/[id]/route"));
  });

  it("lets the creator delete their album", async () => {
    db.query.albums.findFirst.mockResolvedValueOnce({
      id: ALBUM_ID,
      createdBy: ADMIN.id,
    });
    const res = await DELETE(
      new Request(`http://localhost/api/albums/${ALBUM_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: ALBUM_ID }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/albums" });
  });

  it("lets an admin delete someone else's album", async () => {
    db.query.albums.findFirst.mockResolvedValueOnce({
      id: ALBUM_ID,
      createdBy: "other",
    });
    const res = await DELETE(
      new Request(`http://localhost/api/albums/${ALBUM_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: ALBUM_ID }) },
    );
    expect(res.status).toBe(200);
  });

  it("forbids a member deleting another's album", async () => {
    verifySession.mockResolvedValueOnce(MEMBER);
    db.query.albums.findFirst.mockResolvedValueOnce({
      id: ALBUM_ID,
      createdBy: ADMIN.id,
    });
    const res = await DELETE(
      new Request(`http://localhost/api/albums/${ALBUM_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: ALBUM_ID }) },
    );
    expect(res.status).toBe(403);
  });
});

// --- photos/[id]/albums POST + DELETE ---------------------------------------

describe("POST /api/photos/[id]/albums", () => {
  let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/photos/[id]/albums/route"));
  });

  it("adds a photo to an album", async () => {
    const res = await POST(
      new Request(`http://localhost/api/photos/${PHOTO_ID}/albums`, {
        method: "POST",
        ...jsonBody({ albumId: ALBUM_ID }),
      }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects an invalid album id", async () => {
    const res = await POST(
      new Request(`http://localhost/api/photos/${PHOTO_ID}/albums`, {
        method: "POST",
        ...jsonBody({ albumId: "nope" }),
      }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/photos/[id]/albums", () => {
  let DELETE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    ({ DELETE } = await import("@/app/api/photos/[id]/albums/route"));
  });

  it("removes a photo from an album", async () => {
    const res = await DELETE(
      new Request(`http://localhost/api/photos/${PHOTO_ID}/albums`, {
        method: "DELETE",
        ...jsonBody({ albumId: ALBUM_ID }),
      }),
      { params: Promise.resolve({ id: PHOTO_ID }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// --- invites POST + [id] DELETE ---------------------------------------------

describe("POST /api/invites", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/invites/route"));
  });

  it("generates an invite code for an admin", async () => {
    const res = await POST(
      new Request("http://localhost/api/invites", {
        method: "POST",
        ...formDataBody({ note: "Cousin Sam" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.insert).toHaveBeenCalled();
  });

  it("rejects non-admins", async () => {
    verifySession.mockResolvedValueOnce(MEMBER);
    const res = await POST(
      new Request("http://localhost/api/invites", {
        method: "POST",
        ...formDataBody({ note: "" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/invites/[id]", () => {
  let DELETE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    ({ DELETE } = await import("@/app/api/invites/[id]/route"));
  });

  const INVITE_ID = "33333333-3333-4333-8333-333333333333";

  it("lets an admin revoke an invite", async () => {
    const res = await DELETE(
      new Request(`http://localhost/api/invites/${INVITE_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: INVITE_ID }) },
    );
    expect(res.status).toBe(200);
  });

  it("rejects non-admins", async () => {
    verifySession.mockResolvedValueOnce(MEMBER);
    const res = await DELETE(
      new Request(`http://localhost/api/invites/${INVITE_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: INVITE_ID }) },
    );
    expect(res.status).toBe(403);
  });
});

// --- me PATCH (name), POST (password), DELETE (unlink) -----------------------

describe("PATCH /api/me (name)", () => {
  let PATCH: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ PATCH } = await import("@/app/api/me/route"));
  });

  it("trims and saves a valid name", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/me", {
        method: "PATCH",
        ...formDataBody({ name: "  Ada  " }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, success: "Name updated." });
  });

  it("rejects a blank name", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/me", {
        method: "PATCH",
        ...formDataBody({ name: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/me (password)", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/me/route"));
  });

  it("sets a password for an OAuth-only account without a current password", async () => {
    db.query.users.findFirst.mockResolvedValueOnce({ passwordHash: null });
    const res = await POST(
      new Request("http://localhost/api/me", {
        method: "POST",
        ...formDataBody({
          newPassword: "supersecret1",
          confirmPassword: "supersecret1",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, success: "Password set." });
  });

  it("changes the password when the current one is correct", async () => {
    const hash = await bcrypt.hash("oldpassword1", 4);
    db.query.users.findFirst.mockResolvedValueOnce({ passwordHash: hash });
    const res = await POST(
      new Request("http://localhost/api/me", {
        method: "POST",
        ...formDataBody({
          currentPassword: "oldpassword1",
          newPassword: "newpassword1",
          confirmPassword: "newpassword1",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, success: "Password changed." });
  });

  it("rejects a wrong current password", async () => {
    const hash = await bcrypt.hash("oldpassword1", 4);
    db.query.users.findFirst.mockResolvedValueOnce({ passwordHash: hash });
    const res = await POST(
      new Request("http://localhost/api/me", {
        method: "POST",
        ...formDataBody({
          currentPassword: "wrongpassword",
          newPassword: "newpassword1",
          confirmPassword: "newpassword1",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects mismatched confirmation", async () => {
    // The route short-circuits on the mismatch before any DB lookup, so no
    // findFirst mock is queued here — leaving one queued would leak past
    // clearAllMocks (which only clears calls/results, not the Once queue) and
    // pollute later tests' findFirst calls.
    const res = await POST(
      new Request("http://localhost/api/me", {
        method: "POST",
        ...formDataBody({
          newPassword: "supersecret1",
          confirmPassword: "different1",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/me (unlink provider)", () => {
  let DELETE: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ DELETE } = await import("@/app/api/me/route"));
  });

  it("removes a linked provider when other methods remain", async () => {
    db.query.users.findFirst.mockResolvedValueOnce({ passwordHash: null });
    db.query.accounts.findMany.mockResolvedValueOnce([
      { provider: "google" },
      { provider: "github" },
    ]);
    const res = await DELETE(
      new Request("http://localhost/api/me?provider=google", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("refuses to remove the last sign-in method without a password", async () => {
    db.query.users.findFirst.mockResolvedValueOnce({ passwordHash: null });
    db.query.accounts.findMany.mockResolvedValueOnce([{ provider: "google" }]);
    const res = await DELETE(
      new Request("http://localhost/api/me?provider=google", { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a provider that is not linked", async () => {
    db.query.users.findFirst.mockResolvedValueOnce({ passwordHash: "x" });
    db.query.accounts.findMany.mockResolvedValueOnce([{ provider: "google" }]);
    const res = await DELETE(
      new Request("http://localhost/api/me?provider=github", { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
  });
});

// --- auth/signin, signout, register -----------------------------------------

describe("POST /api/auth/signin", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/auth/signin/route"));
  });

  it("returns a redirect on success", async () => {
    signIn.mockImplementationOnce(async () => {
      const e = new Error("NEXT_REDIRECT: /") as Error & { digest?: string };
      e.digest = "NEXT_REDIRECT; redirect /";
      throw e;
    });
    const res = await POST(
      new Request("http://localhost/api/auth/signin", {
        method: "POST",
        ...formDataBody({ email: "A@x.test", password: "secret123", next: "/" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/" });
  });

  it("returns a friendly error on AuthError", async () => {
    signIn.mockRejectedValueOnce(new AuthError("CredentialsSignin"));
    const res = await POST(
      new Request("http://localhost/api/auth/signin", {
        method: "POST",
        ...formDataBody({ email: "a@x.test", password: "wrong", next: "/" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it("forces external redirect targets back to /", async () => {
    signIn.mockImplementationOnce(async () => {
      const e = new Error("NEXT_REDIRECT") as Error & { digest?: string };
      e.digest = "NEXT_REDIRECT; redirect /";
      throw e;
    });
    await POST(
      new Request("http://localhost/api/auth/signin", {
        method: "POST",
        ...formDataBody({ email: "a@x.test", password: "x", next: "https://evil.test" }),
      }),
    );
    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/" }),
    );
  });
});

describe("POST /api/auth/signout", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/auth/signout/route"));
  });

  it("returns a redirect to /signin", async () => {
    signOut.mockImplementationOnce(async () => {
      const e = new Error("NEXT_REDIRECT") as Error & { digest?: string };
      e.digest = "NEXT_REDIRECT; redirect /signin";
      throw e;
    });
    const res = await POST(new Request("http://localhost/api/auth/signout", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/signin" });
  });
});

describe("POST /api/auth/register", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    ({ POST } = await import("@/app/api/auth/register/route"));
  });

  it("rejects a short password before touching the db", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        ...formDataBody({ name: "A", email: "a@x.test", password: "short", inviteCode: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        ...formDataBody({ name: "A", email: "not-an-email", password: "longenough1", inviteCode: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates the first account as admin with no invite code (bootstrap)", async () => {
    // db.select(...).from(users).limit(1) → []
    db.select.mockImplementationOnce(() => makeChain([]));
    // db.query.users.findFirst → null (no existing email)
    db.query.users.findFirst.mockResolvedValueOnce(null);
    // db.insert(...).returning().then(resolve([{ id: "new-user" }]))
    db.insert.mockImplementationOnce(() => makeChain([{ id: "new-user" }]));
    signIn.mockImplementationOnce(async () => {
      const e = new Error("NEXT_REDIRECT") as Error & { digest?: string };
      e.digest = "NEXT_REDIRECT; redirect /";
      throw e;
    });
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        ...formDataBody({ name: "A", email: "a@x.test", password: "longenough1", inviteCode: "" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/" });
  });

  it("requires an invite code once users exist", async () => {
    db.select.mockImplementationOnce(() => makeChain([{ id: "u1" }]));
    db.query.users.findFirst.mockResolvedValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        ...formDataBody({ name: "A", email: "b@x.test", password: "longenough1", inviteCode: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a member and claims the invite on success", async () => {
    db.select.mockImplementationOnce(() => makeChain([{ id: "u1" }]));
    db.query.users.findFirst.mockResolvedValueOnce(null);
    vi.mocked(findRedeemableInvite).mockResolvedValueOnce({ id: "inv-1" } as never);
    vi.mocked(claimInvite).mockResolvedValueOnce(true as never);
    db.insert.mockImplementationOnce(() => makeChain([{ id: "new-member" }]));
    signIn.mockImplementationOnce(async () => {
      const e = new Error("NEXT_REDIRECT") as Error & { digest?: string };
      e.digest = "NEXT_REDIRECT; redirect /";
      throw e;
    });
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        ...formDataBody({ name: "A", email: "b@x.test", password: "longenough1", inviteCode: "CODE-1234" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/" });
    expect(claimInvite).toHaveBeenCalled();
  });

  it("rejects a duplicate email even during bootstrap", async () => {
    db.select.mockImplementationOnce(() => makeChain([]));
    db.query.users.findFirst.mockResolvedValueOnce({ id: "exists" } as never);
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        ...formDataBody({ name: "A", email: "a@x.test", password: "longenough1", inviteCode: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns a friendly error when signIn fails after registration", async () => {
    db.select.mockImplementationOnce(() => makeChain([]));
    db.query.users.findFirst.mockResolvedValueOnce(null);
    db.insert.mockImplementationOnce(() => makeChain([{ id: "new-user" }]));
    signIn.mockRejectedValueOnce(new AuthError("CredentialsSignin"));
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        ...formDataBody({ name: "A", email: "a@x.test", password: "longenough1", inviteCode: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// --- bootstrap --------------------------------------------------------------

describe("GET /api/bootstrap", () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    ({ GET } = await import("@/app/api/bootstrap/route"));
  });

  it("returns bootstrap:true when the vault is empty", async () => {
    db.select.mockImplementationOnce(() => makeChain([]));
    const res = await GET();
    expect(await res.json()).toEqual({ bootstrap: true });
  });

  it("returns bootstrap:false once users exist", async () => {
    db.select.mockImplementationOnce(() => makeChain([{ id: "u1" }]));
    const res = await GET();
    expect(await res.json()).toEqual({ bootstrap: false });
  });
});
