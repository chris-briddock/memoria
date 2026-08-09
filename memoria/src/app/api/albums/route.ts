import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { albums } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { listAlbums } from "@/lib/queries";
import { field } from "@/lib/form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const albums = await listAlbums();
  return NextResponse.json(albums);
}

export async function POST(request: Request) {
  const user = await verifySession();

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const name = field(formData, "name").trim();
  if (!name) {
    return NextResponse.json({ error: "Album name is required." }, { status: 400 });
  }

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

  return NextResponse.json({ ok: true, id: album.id, redirect: `/albums/${album.id}` });
}
