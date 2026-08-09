import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { listInvites } from "@/lib/queries";
import { field } from "@/lib/form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await verifySession();
  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "Only an admin can view invites." },
      { status: 403 },
    );
  }
  const invites = await listInvites();
  return NextResponse.json(invites);
}

export async function POST(request: Request) {
  const user = await verifySession();
  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "Only an admin can create invites." },
      { status: 403 },
    );
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
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

  return NextResponse.json({ ok: true });
}
