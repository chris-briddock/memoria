"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import { signIn } from "@/auth";
import { field } from "@/lib/form";
import type { OAuthProviderId } from "@/lib/oauth-providers";

/**
 * Linking an OAuth provider to the current account is intentionally thin: the
 * user is already signed in, and Auth.js's handle-login links an unlinked OAuth
 * identity to the active session automatically. This action just starts that
 * redirect back to the settings page. The "already linked to someone else"
 * case is rejected by Auth.js with `?error=OAuthAccountNotLinked`.
 */
export async function linkOAuthAccount(provider: OAuthProviderId) {
  await verifySession();
  await signIn(provider, { redirectTo: "/settings" });
}

export type UnlinkResult = { error?: string } | undefined;

/**
 * Remove an OAuth provider from the current account. Guarded so the account
 * always keeps at least one working sign-in method: you cannot remove your
 * only OAuth provider unless a password is set (decision: never lock a user
 * out of their own vault).
 */
export async function unlinkOAuthAccount(
  provider: OAuthProviderId,
): Promise<UnlinkResult> {
  const session = await verifySession();

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.id),
    columns: { passwordHash: true },
  });
  if (!user) return { error: "Account not found." };

  const linked = await db.query.accounts.findMany({
    where: eq(accounts.userId, session.id),
    columns: { provider: true },
  });

  const isLinked = linked.some((a) => a.provider === provider);
  if (!isLinked) return { error: "That provider is not linked to your account." };

  const hasPassword = Boolean(user.passwordHash);
  const otherMethods =
    linked.filter((a) => a.provider !== provider).length + (hasPassword ? 1 : 0);

  if (otherMethods === 0) {
    return {
      error:
        "Set a password before removing your last sign-in method, or you would lock yourself out.",
    };
  }

  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, session.id), eq(accounts.provider, provider)));

  revalidatePath("/settings");
}

// ---------------------------------------------------------------------------
// Profile: display name and password.
// ---------------------------------------------------------------------------

export type ProfileResult = { error?: string; success?: string } | undefined;

const nameSchema = z.string().trim().min(1, "Please enter your name").max(80);

/** Update the signed-in user's display name. */
export async function updateName(
  _prev: ProfileResult,
  formData: FormData,
): Promise<ProfileResult> {
  const session = await verifySession();
  const parsed = nameSchema.safeParse(field(formData, "name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await db.update(users).set({ name: parsed.data }).where(eq(users.id, session.id));
  revalidatePath("/settings");
  revalidatePath("/", "layout"); // the nav shows the name
  return { success: "Name updated." };
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
export async function changePassword(
  _prev: ProfileResult,
  formData: FormData,
): Promise<ProfileResult> {
  const session = await verifySession();
  const parsed = passwordSchema.safeParse({
    currentPassword: field(formData, "currentPassword"),
    newPassword: field(formData, "newPassword"),
    confirmPassword: field(formData, "confirmPassword"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    return { error: "The new passwords do not match." };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.id),
    columns: { passwordHash: true },
  });
  if (!user) return { error: "Account not found." };

  if (user.passwordHash) {
    if (!currentPassword) return { error: "Enter your current password." };
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return { error: "Your current password is not correct." };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, session.id));
  revalidatePath("/settings");
  return { success: user.passwordHash ? "Password changed." : "Password set." };
}
