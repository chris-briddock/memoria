import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { photos } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { deleteObjects } from "@/lib/storage";
import { getPhoto } from "@/lib/queries";
import { field } from "@/lib/form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await getPhoto(id);
  if (!row) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await verifySession();
  const { id } = await params;
  const uuid = z.uuid().safeParse(id);
  if (!uuid.success) {
    return NextResponse.json({ error: "Invalid photo id" }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const caption = field(formData, "caption").trim().slice(0, 500);

  await db
    .update(photos)
    .set({ caption: caption || null })
    .where(eq(photos.id, uuid.data));

  revalidatePath(`/photos/${uuid.data}`);

  return NextResponse.json({ ok: true });
}

/**
 * Removes the row and its objects. Only the uploader or an admin may delete,
 * so one relative cannot wipe another's contributions.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await verifySession();
  const { id } = await params;
  const uuid = z.uuid().safeParse(id);
  if (!uuid.success) {
    return NextResponse.json({ error: "Invalid photo id" }, { status: 400 });
  }

  const photo = await db.query.photos.findFirst({ where: eq(photos.id, uuid.data) });
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  if (photo.uploadedBy !== user.id && user.role !== "admin") {
    return NextResponse.json(
      { error: "You can only delete photos you uploaded." },
      { status: 403 },
    );
  }

  await db.delete(photos).where(eq(photos.id, uuid.data));
  await deleteObjects([photo.storageKey, photo.thumbKey]);

  revalidatePath("/");

  return NextResponse.json({ ok: true, redirect: "/" });
}
