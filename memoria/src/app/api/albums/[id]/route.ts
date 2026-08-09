import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { albums } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { getAlbum } from "@/lib/queries";

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
    return NextResponse.json(
      { error: "You can only delete albums you created." },
      { status: 403 },
    );
  }

  // album_photos cascades; the photos themselves are untouched.
  await db.delete(albums).where(eq(albums.id, aid.data));

  revalidatePath("/albums");

  return NextResponse.json({ ok: true, redirect: "/albums" });
}
