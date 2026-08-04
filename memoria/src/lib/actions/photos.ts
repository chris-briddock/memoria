"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { albumPhotos, albums, invites, photos } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { deleteObjects } from "@/lib/storage";
import { field } from "@/lib/form";

const uuid = z.uuid();

export async function toggleFavorite(photoId: string) {
  await verifySession();
  const id = uuid.parse(photoId);

  const photo = await db.query.photos.findFirst({ where: eq(photos.id, id) });
  if (!photo) return;

  await db
    .update(photos)
    .set({ favorite: !photo.favorite })
    .where(eq(photos.id, id));

  revalidatePath("/");
  revalidatePath(`/photos/${id}`);
}

export async function updateCaption(photoId: string, formData: FormData) {
  await verifySession();
  const id = uuid.parse(photoId);
  const caption = field(formData, "caption").trim().slice(0, 500);

  await db
    .update(photos)
    .set({ caption: caption || null })
    .where(eq(photos.id, id));

  revalidatePath(`/photos/${id}`);
}

/**
 * Removes the row and its objects. Only the uploader or an admin may delete,
 * so one relative cannot wipe another's contributions.
 */
export async function deletePhoto(photoId: string) {
  const user = await verifySession();
  const id = uuid.parse(photoId);

  const photo = await db.query.photos.findFirst({ where: eq(photos.id, id) });
  if (!photo) return;

  if (photo.uploadedBy !== user.id && user.role !== "admin") {
    throw new Error("You can only delete photos you uploaded.");
  }

  await db.delete(photos).where(eq(photos.id, id));
  await deleteObjects([photo.storageKey, photo.thumbKey]);

  revalidatePath("/");
  redirect("/");
}

export async function createAlbum(formData: FormData) {
  const user = await verifySession();

  const name = field(formData, "name").trim();
  if (!name) return;

  const description = field(formData, "description").trim();

  const [album] = await db
    .insert(albums)
    .values({
      name: name.slice(0, 120),
      description: description ? description.slice(0, 500) : null,
      createdBy: user.id,
    })
    .returning({ id: albums.id });

  revalidatePath("/albums");
  redirect(`/albums/${album.id}`);
}

export async function setPhotoAlbum(
  photoId: string,
  albumId: string,
  shouldBeIn: boolean,
) {
  await verifySession();
  const pid = uuid.parse(photoId);
  const aid = uuid.parse(albumId);

  if (shouldBeIn) {
    await db
      .insert(albumPhotos)
      .values({ albumId: aid, photoId: pid })
      .onConflictDoNothing();

    // Give a new album a cover the moment it gets its first photo.
    await db
      .update(albums)
      .set({ coverPhotoId: pid })
      .where(and(eq(albums.id, aid), isNull(albums.coverPhotoId)));
  } else {
    await db
      .delete(albumPhotos)
      .where(and(eq(albumPhotos.albumId, aid), eq(albumPhotos.photoId, pid)));
  }

  revalidatePath(`/albums/${aid}`);
  revalidatePath(`/photos/${pid}`);
  revalidatePath("/albums");
}

export async function deleteAlbum(albumId: string) {
  const user = await verifySession();
  const aid = uuid.parse(albumId);

  const album = await db.query.albums.findFirst({ where: eq(albums.id, aid) });
  if (!album) return;

  if (album.createdBy !== user.id && user.role !== "admin") {
    throw new Error("You can only delete albums you created.");
  }

  // album_photos cascades; the photos themselves are untouched.
  await db.delete(albums).where(eq(albums.id, aid));

  revalidatePath("/albums");
  redirect("/albums");
}

export async function createInvite(formData: FormData) {
  const user = await verifySession();
  if (user.role !== "admin") {
    throw new Error("Only an admin can create invites.");
  }

  const note = field(formData, "note").trim();
  // Ambiguity-free alphabet: no O/0, I/1.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  const code = Array.from(bytes, (b) => alphabet[b % alphabet.length])
    .join("")
    .replace(/(.{4})(?=.)/g, "$1-");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.insert(invites).values({
    code,
    note: note ? note.slice(0, 200) : null,
    createdBy: user.id,
    expiresAt,
  });

  revalidatePath("/settings/family");
}

export async function revokeInvite(inviteId: string) {
  const user = await verifySession();
  if (user.role !== "admin") {
    throw new Error("Only an admin can revoke invites.");
  }
  await db.delete(invites).where(eq(invites.id, uuid.parse(inviteId)));
  revalidatePath("/settings/family");
}
