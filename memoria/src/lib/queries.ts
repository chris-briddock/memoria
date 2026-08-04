import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, albumPhotos, albums, invites, photos, users } from "@/db/schema";
import { verifySession } from "./dal";

/**
 * Every family member can see the whole vault, but each query still asserts a
 * session so no data path is reachable unauthenticated.
 */

export async function listPhotos(limit = 200) {
  await verifySession();
  return db
    .select({
      id: photos.id,
      caption: photos.caption,
      originalFilename: photos.originalFilename,
      width: photos.width,
      height: photos.height,
      takenAt: photos.takenAt,
      favorite: photos.favorite,
    })
    .from(photos)
    .orderBy(desc(photos.takenAt), desc(photos.createdAt))
    .limit(limit);
}

export async function getPhoto(id: string) {
  await verifySession();
  const [row] = await db
    .select({
      photo: photos,
      uploaderName: users.name,
      uploaderEmail: users.email,
    })
    .from(photos)
    .innerJoin(users, eq(users.id, photos.uploadedBy))
    .where(eq(photos.id, id))
    .limit(1);
  return row ?? null;
}

export async function listAlbums() {
  await verifySession();
  return db
    .select({
      id: albums.id,
      name: albums.name,
      description: albums.description,
      coverPhotoId: albums.coverPhotoId,
      createdAt: albums.createdAt,
      photoCount: sql<number>`cast(count(${albumPhotos.photoId}) as int)`,
    })
    .from(albums)
    .leftJoin(albumPhotos, eq(albumPhotos.albumId, albums.id))
    .groupBy(albums.id)
    .orderBy(desc(albums.createdAt));
}

export async function getAlbum(id: string) {
  await verifySession();
  const album = await db.query.albums.findFirst({ where: eq(albums.id, id) });
  if (!album) return null;

  const items = await db
    .select({
      id: photos.id,
      caption: photos.caption,
      originalFilename: photos.originalFilename,
      width: photos.width,
      height: photos.height,
      takenAt: photos.takenAt,
      favorite: photos.favorite,
    })
    .from(albumPhotos)
    .innerJoin(photos, eq(photos.id, albumPhotos.photoId))
    .where(eq(albumPhotos.albumId, id))
    .orderBy(desc(photos.takenAt));

  return { album, photos: items };
}

export async function getVaultStats() {
  await verifySession();
  const [[photoStats], [albumCount], [memberCount]] = await Promise.all([
    db
      .select({
        total: count(),
        bytes: sql<string>`coalesce(sum(${photos.byteSize}), 0)`,
      })
      .from(photos),
    db.select({ total: count() }).from(albums),
    db.select({ total: count() }).from(users),
  ]);

  return {
    photos: photoStats.total,
    bytes: Number(photoStats.bytes),
    albums: albumCount.total,
    members: memberCount.total,
  };
}

export async function albumsForPhoto(photoId: string) {
  await verifySession();
  return db
    .select({ id: albums.id, name: albums.name })
    .from(albumPhotos)
    .innerJoin(albums, eq(albums.id, albumPhotos.albumId))
    .where(eq(albumPhotos.photoId, photoId));
}

export async function listInvites() {
  const user = await verifySession();
  if (user.role !== "admin") return [];
  return db
    .select({
      id: invites.id,
      code: invites.code,
      note: invites.note,
      claimedAt: invites.claimedAt,
      expiresAt: invites.expiresAt,
      createdAt: invites.createdAt,
    })
    .from(invites)
    .orderBy(desc(invites.createdAt));
}

export async function listMembers() {
  const user = await verifySession();
  if (user.role !== "admin") return [];
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      photoCount: sql<number>`cast(count(${photos.id}) as int)`,
    })
    .from(users)
    .leftJoin(photos, eq(photos.uploadedBy, users.id))
    .groupBy(users.id)
    .orderBy(users.createdAt);
}

export async function isPhotoInAlbum(albumId: string, photoId: string) {
  await verifySession();
  const row = await db.query.albumPhotos.findFirst({
    where: and(eq(albumPhotos.albumId, albumId), eq(albumPhotos.photoId, photoId)),
  });
  return Boolean(row);
}

/**
 * The OAuth providers linked to the current user's account, plus whether a
 * password is set — the settings "Sign-in methods" section renders from this.
 */
export async function listSignInMethods() {
  const user = await verifySession();
  const [row, linked] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, user.id),
      columns: { passwordHash: true },
    }),
    db.query.accounts.findMany({
      where: eq(accounts.userId, user.id),
      columns: { provider: true },
    }),
  ]);
  return {
    hasPassword: Boolean(row?.passwordHash),
    providers: linked.map((a) => a.provider),
  };
}
