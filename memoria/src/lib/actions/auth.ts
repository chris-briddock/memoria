"use server";

import { count, eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { signIn, signOut } from "@/auth";
import {
  findRedeemableInvite,
  setOAuthInviteCookie,
  claimInvite,
} from "@/lib/oauth";
import { OAUTH_PROVIDERS } from "@/lib/oauth-providers";
import { field } from "@/lib/form";

export type FormState = { error?: string } | undefined;

const registerSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address")),
  password: z.string().min(10, "Use at least 10 characters"),
  inviteCode: z.string().trim(),
});

export async function signInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const next = (formData.get("next") as string) || "/";
  try {
    await signIn("credentials", {
      email: field(formData, "email").toLowerCase(),
      password: field(formData, "password"),
      redirectTo: next.startsWith("/") ? next : "/",
    });
  } catch (error) {
    // `signIn` throws a redirect on success; let that propagate.
    if (error instanceof AuthError) {
      return { error: "That email and password combination isn't right." };
    }
    throw error;
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}

/**
 * Registration is closed by default. The very first account may be created
 * without an invite (and becomes admin); everyone after that needs a code
 * minted by an admin.
 */
export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    name: field(formData, "name"),
    email: field(formData, "email"),
    password: field(formData, "password"),
    inviteCode: field(formData, "inviteCode"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const { name, email, password, inviteCode } = parsed.data;

  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const isBootstrap = userCount === 0;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return { error: "An account with that email already exists." };

  let claimedInviteId: string | null = null;

  if (!isBootstrap) {
    if (!inviteCode) return { error: "An invite code is required." };

    const invite = await findRedeemableInvite(inviteCode);
    if (!invite) return { error: "That invite code is not valid or has been used." };
    claimedInviteId = invite.id;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const bootstrapEmail = process.env.MEMORIA_BOOTSTRAP_EMAIL?.toLowerCase();
  const role =
    isBootstrap || (bootstrapEmail && email === bootstrapEmail) ? "admin" : "member";

  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash, role })
    .returning();

  if (claimedInviteId) {
    // Conditional on still being unclaimed, so two people racing the same code
    // cannot both succeed.
    const won = await claimInvite(claimedInviteId, user.id);
    if (!won) {
      await db.delete(users).where(eq(users.id, user.id));
      return { error: "That invite code was just used by someone else." };
    }
  }

  await signIn("credentials", { email, password, redirectTo: "/" });
}

/**
 * Begin an OAuth sign-in. When an invite code is supplied (the /register
 * "Continue with …" path), it is validated up front so the user gets an inline
 * error instead of a redirect to the provider, then carried through the OAuth
 * round-trip in a signed httpOnly cookie for the adapter's `createUser` gate.
 * On /signin (or settings linking) no code is needed — a linked account signs
 * straight in, and a signed-in user links the provider to their account.
 */
export async function beginOAuthSignIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const provider = field(formData, "provider");
  const inviteCode = field(formData, "inviteCode").trim();
  const next = field(formData, "next") || "/";
  const redirectTo = next.startsWith("/") ? next : "/";

  if (provider !== "google") {
    return { error: "Unknown sign-in provider." };
  }

  if (!OAUTH_PROVIDERS.find((p) => p.id === provider)?.enabled) {
    return {
      error: "Sign-in with Google is not configured on this server yet.",
    };
  }

  if (inviteCode) {
    const invite = await findRedeemableInvite(inviteCode);
    if (!invite) {
      return { error: "That invite code is not valid or has been used." };
    }
    await setOAuthInviteCookie(inviteCode);
  }

  try {
    // signIn() throws the provider redirect; let it propagate.
    await signIn(provider, { redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Could not start sign-in with that provider." };
    }
    throw error;
  }
}
