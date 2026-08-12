import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { albums } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { getAlbum } from "@/lib/queries";
import { logger } from "@/lib/logger";

const log = logger("api.albums");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getAlbum(id);
  if (!result) {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await verifySession();
  const { id } = await params;
  const aid = z.uuid().safeParse(id);
  if (!aid.success) {
    return NextResponse.json({ error: "Invalid album id" }, { status: 400 });
  }

  const album = await db.query.albums.findFirst({ where: eq(albums.id, aid.data) });
  if (!album) {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }

  if (album.createdBy !== user.id && user.role !== "admin") {
    log.warn("album delete denied: not owner or admin", {
      album_id: album.id,
      owner_id: album.createdBy,
      user_id: user.id,
    });
    return NextResponse.json(
      { error: "You can only delete albums you created." },
      { status: 403 },
    );
  }

  // album_photos cascades; the photos themselves are untouched.
  await db.delete(albums).where(eq(albums.id, aid.data));

  log.info("album deleted", {
    album_id: album.id,
    owner_id: album.createdBy,
    deleted_by: user.id,
    deleted_by_admin: album.createdBy !== user.id,
  });

  revalidatePath("/albums");

  return NextResponse.json({ ok: true, redirect: "/albums" });
}
