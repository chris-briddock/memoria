import { NextResponse } from "next/server";
import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { signIn } from "@/auth";
import {
  findRedeemableInvite,
  claimInvite,
} from "@/lib/oauth";
import { field } from "@/lib/form";
import { logger } from "@/lib/logger";

const log = logger("api.register");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * Registration is closed by default. The very first account may be created
 * without an invite (and becomes admin); everyone after that needs a code
 * minted by an admin. On success, `signIn()` is called which throws a redirect
 * — we convert that to a JSON `{ redirect }`.
 */
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse({
    name: field(formData, "name"),
    email: field(formData, "email"),
    password: field(formData, "password"),
    inviteCode: field(formData, "inviteCode"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { name, email, password, inviteCode } = parsed.data;

  // Existence check, not COUNT(*): the bootstrap decision only needs to know
  // if the users table is empty. COUNT(*) forces a full table scan (Postgres
  // MVCC can't satisfy it from an index), which gets expensive as the vault
  // grows; LIMIT 1 returns instantly and stays O(1).
  const anyUser = await db.select({ id: users.id }).from(users).limit(1);
  const isBootstrap = anyUser.length === 0;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    log.info("registration rejected: email already registered");
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 400 });
  }

  let claimedInviteId: string | null = null;

  if (!isBootstrap) {
    if (!inviteCode) {
      log.info("registration rejected: invite code missing");
      return NextResponse.json({ error: "An invite code is required." }, { status: 400 });
    }

    const invite = await findRedeemableInvite(inviteCode);
    if (!invite) {
      log.info("registration rejected: invite not redeemable");
      return NextResponse.json({ error: "That invite code is not valid or has been used." }, { status: 400 });
    }
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
      log.warn("invite claim lost to a race; rolling back registration", {
        user_id: user.id,
        invite_id: claimedInviteId,
      });
      await db.delete(users).where(eq(users.id, user.id));
      return NextResponse.json(
        { error: "That invite code was just used by someone else." },
        { status: 400 },
      );
    }
  }

  log.info("user registered", {
    user_id: user.id,
    role,
    is_bootstrap: isBootstrap,
    used_invite: Boolean(claimedInviteId),
  });

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    // Unreachable: signIn throws on success.
    return NextResponse.json({ ok: true, redirect: "/" });
  } catch (error) {
    if (error instanceof AuthError) {
      // The account now exists but the user is signed out — worth surfacing
      // loudly since it strands a freshly registered user at the form.
      log.error("sign-in failed immediately after successful registration", { user_id: user.id }, error);
      return NextResponse.json({ error: "Sign-in failed after registration." }, { status: 400 });
    }
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) {
      return NextResponse.json({ ok: true, redirect: "/" });
    }
    throw error;
  }
}
