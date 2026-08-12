import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { logger } from "@/lib/logger";

const log = logger("api.invites");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await verifySession();
  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "Only an admin can revoke invites." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const iid = z.uuid().safeParse(id);
  if (!iid.success) {
    return NextResponse.json({ error: "Invalid invite id" }, { status: 400 });
  }

  const deleted = await db
    .delete(invites)
    .where(eq(invites.id, iid.data))
    .returning({ id: invites.id });
  if (deleted.length > 0) {
    log.info("invite revoked", { invite_id: iid.data, admin_user_id: user.id });
  }
  revalidatePath("/settings/family");

  return NextResponse.json({ ok: true });
}
