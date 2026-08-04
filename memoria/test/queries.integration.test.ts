// Integration test against a real, disposable Postgres database
// (`memoria_test`). Run `npm run db:up` first; global-setup pushes the schema.
//
// The connection string must be set before `@/db` is imported, and the dev
// server caches the pg Pool on `globalThis`, so both are arranged up front.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// DATABASE_URL + pool reset live in setup.integration.ts (setupFiles), which
// runs before this module's imports are evaluated.

// Queries assert a session via `verifySession`, which is built on React
// `cache` + `@/auth`. Mock it to control identity without a request context.
const { verifySession } = vi.hoisted(() => ({ verifySession: vi.fn() }));
vi.mock("@/lib/dal", () => ({ verifySession }));

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, albumPhotos, albums, invites, photos, users } from "@/db/schema";
import {
  albumsForPhoto,
  getAlbum,
  getPhoto,
  getVaultStats,
  isPhotoInAlbum,
  listAlbums,
  listInvites,
  listMembers,
  listPhotos,
  listSignInMethods,
} from "@/lib/queries";

const ADMIN = {
  id: randomUUID(),
  email: "admin@test.dev",
  name: "Admin",
  role: "admin" as const,
};
const MEMBER = {
  id: randomUUID(),
  email: "member@test.dev",
  name: "Member",
  role: "member" as const,
};

async function truncateAll() {
  await db.execute(
    sql`TRUNCATE album_photos, albums, photos, invites, users RESTART IDENTITY CASCADE`,
  );
}

function makePhoto(overrides: Partial<typeof photos.$inferInsert> = {}) {
  return {
    storageKey: `${randomUUID()}/orig.jpg`,
    thumbKey: `${randomUUID()}/thumb.webp`,
    originalFilename: "photo.jpg",
    mimeType: "image/jpeg",
    byteSize: 1024,
    checksum: randomUUID().replaceAll("-", ""),
    uploadedBy: ADMIN.id,
    ...overrides,
  };
}

beforeAll(async () => {
  await truncateAll();
  await db.insert(users).values([ADMIN, MEMBER]);
});

beforeEach(() => {
  vi.clearAllMocks();
  verifySession.mockResolvedValue(ADMIN);
});

describe("listPhotos", () => {
  it("returns photos newest-taken first, respecting the limit", async () => {
    await truncateAll();
    await db.insert(users).values([ADMIN, MEMBER]);
    await db.insert(photos).values([
      makePhoto({ originalFilename: "old.jpg", takenAt: new Date(2020, 0, 1) }),
      makePhoto({ originalFilename: "new.jpg", takenAt: new Date(2023, 0, 1) }),
      makePhoto({ originalFilename: "mid.jpg", takenAt: new Date(2021, 0, 1) }),
    ]);

    const result = await listPhotos();

    expect(result.map((p) => p.originalFilename)).toEqual([
      "new.jpg",
      "mid.jpg",
      "old.jpg",
    ]);
  });

  it("honours the limit argument", async () => {
    const result = await listPhotos(2);
    expect(result).toHaveLength(2);
  });
});

describe("getPhoto", () => {
  it("joins the uploader's identity", async () => {
    const [p] = await db
      .insert(photos)
      .values(makePhoto({ originalFilename: "portrait.jpg" }))
      .returning();

    const row = await getPhoto(p.id);

    expect(row?.photo.originalFilename).toBe("portrait.jpg");
    expect(row?.uploaderEmail).toBe(ADMIN.email);
  });

  it("returns null for an unknown id", async () => {
    expect(await getPhoto(randomUUID())).toBeNull();
  });
});

describe("albums + membership", () => {
  it("lists albums with a photo count and supports membership lookups", async () => {
    const [album] = await db
      .insert(albums)
      .values({ name: "Trips", createdBy: ADMIN.id })
      .returning();
    const [p1, p2] = await db
      .insert(photos)
      .values([makePhoto(), makePhoto()])
      .returning();
    await db.insert(albumPhotos).values([
      { albumId: album.id, photoId: p1.id },
      { albumId: album.id, photoId: p2.id },
    ]);

    const list = await listAlbums();
    const found = list.find((a) => a.id === album.id);
    expect(found?.photoCount).toBe(2);

    expect(await isPhotoInAlbum(album.id, p1.id)).toBe(true);
    expect(await isPhotoInAlbum(album.id, randomUUID())).toBe(false);

    const memberAlbums = await albumsForPhoto(p2.id);
    expect(memberAlbums.map((a) => a.id)).toContain(album.id);
  });

  it("getAlbum returns the album with its photos, or null when missing", async () => {
    const [album] = await db
      .insert(albums)
      .values({ name: "Empty + Full", createdBy: ADMIN.id })
      .returning();
    const [p] = await db.insert(photos).values(makePhoto()).returning();
    await db.insert(albumPhotos).values({ albumId: album.id, photoId: p.id });

    const result = await getAlbum(album.id);
    expect(result?.album.name).toBe("Empty + Full");
    expect(result?.photos).toHaveLength(1);

    expect(await getAlbum(randomUUID())).toBeNull();
  });
});

describe("getVaultStats", () => {
  it("aggregates photos, bytes, albums and members", async () => {
    const stats = await getVaultStats();
    expect(stats.members).toBeGreaterThanOrEqual(2);
    expect(stats.photos).toBeGreaterThanOrEqual(1);
    expect(typeof stats.bytes).toBe("number");
    expect(stats.albums).toBeGreaterThanOrEqual(1);
  });
});

describe("admin-only listings", () => {
  it("listInvites returns rows for admins, [] for members", async () => {
    await db.insert(invites).values({ code: "TEST-CODE", createdBy: ADMIN.id });

    verifySession.mockResolvedValue(ADMIN);
    const asAdmin = await listInvites();
    expect(asAdmin.map((i) => i.code)).toContain("TEST-CODE");

    verifySession.mockResolvedValue(MEMBER);
    expect(await listInvites()).toEqual([]);
  });

  it("listMembers returns photo counts for admins, [] for members", async () => {
    verifySession.mockResolvedValue(ADMIN);
    const members = await listMembers();
    const admin = members.find((m) => m.id === ADMIN.id);
    expect(admin?.email).toBe(ADMIN.email);
    expect(admin?.photoCount).toBeGreaterThanOrEqual(1);

    verifySession.mockResolvedValue(MEMBER);
    expect(await listMembers()).toEqual([]);
  });
});

describe("listSignInMethods", () => {
  it("reports password and linked OAuth providers for the signed-in user", async () => {
    await db.insert(accounts).values([
      {
        userId: ADMIN.id,
        type: "oauth",
        provider: "google",
        providerAccountId: "g-123",
      },
    ]);

    verifySession.mockResolvedValue(ADMIN);
    const methods = await listSignInMethods();

    expect(methods.providers).toEqual(["google"]);
    // ADMIN fixture row has no passwordHash.
    expect(methods.hasPassword).toBe(false);
  });

  it("reports hasPassword when a hash exists and no providers", async () => {
    await db
      .update(users)
      .set({ passwordHash: "hash" })
      .where(sql`id = ${MEMBER.id}`);

    verifySession.mockResolvedValue(MEMBER);
    const methods = await listSignInMethods();

    expect(methods.hasPassword).toBe(true);
    expect(methods.providers).toEqual([]);
  });
});
