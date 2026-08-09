import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { photos } from "@/db/schema";
import { verifySession } from "@/lib/dal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await verifySession();
  const { id } = await params;
  const uuid = z.uuid().safeParse(id);
  if (!uuid.success) {
    return NextResponse.json({ error: "Invalid photo id" }, { status: 400 });
  }

  const photo = await db.query.photos.findFirst({ where: eq(photos.id, uuid.data) });
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  await db
    .update(photos)
    .set({ favorite: !photo.favorite })
    .where(eq(photos.id, uuid.data));

  revalidatePath("/");
  revalidatePath(`/photos/${uuid.data}`);

  return NextResponse.json({ ok: true, favorite: !photo.favorite });
}
