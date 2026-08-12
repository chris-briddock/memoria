import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { albumPhotos, albums } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { albumsForPhoto } from "@/lib/queries";
import { logger } from "@/lib/logger";

const log = logger("api.photos.albums");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const albums = await albumsForPhoto(id);
  return NextResponse.json(albums);
}

/** Add a photo to an album. Body: { albumId } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await verifySession();
  const { id } = await params;
  const pid = z.uuid().safeParse(id);
  if (!pid.success) {
    return NextResponse.json({ error: "Invalid photo id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { albumId?: string }
    | null;
  const aid = z.uuid().safeParse(body?.albumId);
  if (!aid.success) {
    return NextResponse.json({ error: "Invalid album id" }, { status: 400 });
  }

  await db
    .insert(albumPhotos)
    .values({ albumId: aid.data, photoId: pid.data })
    .onConflictDoNothing();

  log.debug("photo added to album", { photo_id: pid.data, album_id: aid.data });

  // Give a new album a cover the moment it gets its first photo.
  await db
    .update(albums)
    .set({ coverPhotoId: pid.data })
    .where(and(eq(albums.id, aid.data), isNull(albums.coverPhotoId)));

  revalidatePath(`/albums/${aid.data}`);
  revalidatePath(`/photos/${pid.data}`);
  revalidatePath("/albums");

  return NextResponse.json({ ok: true });
}

/** Remove a photo from an album. Body: { albumId } */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await verifySession();
  const { id } = await params;
  const pid = z.uuid().safeParse(id);
  if (!pid.success) {
    return NextResponse.json({ error: "Invalid photo id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { albumId?: string }
    | null;
  const aid = z.uuid().safeParse(body?.albumId);
  if (!aid.success) {
    return NextResponse.json({ error: "Invalid album id" }, { status: 400 });
  }

  await db
    .delete(albumPhotos)
    .where(and(eq(albumPhotos.albumId, aid.data), eq(albumPhotos.photoId, pid.data)));

  revalidatePath(`/albums/${aid.data}`);
  revalidatePath(`/photos/${pid.data}`);
  revalidatePath("/albums");

  return NextResponse.json({ ok: true });
}
