import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { field } from "@/lib/form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await verifySession();
  return NextResponse.json(user);
}

const nameSchema = z.string().trim().min(1, "Please enter your name").max(80);

/** Update the signed-in user's display name. */
export async function PATCH(request: Request) {
  const session = await verifySession();

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const parsed = nameSchema.safeParse(field(formData, "name"));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  await db.update(users).set({ name: parsed.data }).where(eq(users.id, session.id));
  revalidatePath("/settings");
  revalidatePath("/", "layout"); // the nav shows the name
  return NextResponse.json({ ok: true, success: "Name updated." });
}

const passwordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(10, "Use at least 10 characters"),
  confirmPassword: z.string(),
});

/**
 * Set or change the signed-in user's password. When a password already exists
 * the current one must be supplied and correct; when none is set yet (the
 * OAuth-join case) only the new password is required — the account is already
 * proven by the session.
 */
export async function POST(request: Request) {
  const session = await verifySession();

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const parsed = passwordSchema.safeParse({
    currentPassword: field(formData, "currentPassword"),
    newPassword: field(formData, "newPassword"),
    confirmPassword: field(formData, "confirmPassword"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "The new passwords do not match." }, { status: 400 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.id),
    columns: { passwordHash: true },
  });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  if (user.passwordHash) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Enter your current password." }, { status: 400 });
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Your current password is not correct." }, { status: 400 });
    }
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, session.id));
  revalidatePath("/settings");
  return NextResponse.json({
    ok: true,
    success: user.passwordHash ? "Password changed." : "Password set.",
  });
}

/**
 * Remove an OAuth provider from the current account. Guarded so the account
 * always keeps at least one working sign-in method: you cannot remove your
 * only OAuth provider unless a password is set.
 */
export async function DELETE(request: Request) {
  const session = await verifySession();

  // Read provider from the request body or query string.
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (!provider) {
    return NextResponse.json({ error: "Provider is required." }, { status: 400 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.id),
    columns: { passwordHash: true },
  });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const linked = await db.query.accounts.findMany({
    where: eq(accounts.userId, session.id),
    columns: { provider: true },
  });

  const isLinked = linked.some((a) => a.provider === provider);
  if (!isLinked) {
    return NextResponse.json(
      { error: "That provider is not linked to your account." },
      { status: 400 },
    );
  }

  const hasPassword = Boolean(user.passwordHash);
  const otherMethods =
    linked.filter((a) => a.provider !== provider).length + (hasPassword ? 1 : 0);

  if (otherMethods === 0) {
    return NextResponse.json(
      {
        error:
          "Set a password before removing your last sign-in method, or you would lock yourself out.",
      },
      { status: 400 },
    );
  }

  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, session.id), eq(accounts.provider, provider)));

  revalidatePath("/settings");
  return NextResponse.json({ ok: true });
}
