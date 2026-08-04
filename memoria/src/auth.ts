import NextAuth, { AuthError } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { count, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Provider } from "next-auth/providers";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import {
  claimInvite,
  clearOAuthInviteCookie,
  findRedeemableInvite,
  readOAuthInviteCookie,
} from "@/lib/oauth";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

/**
 * OAuth account creation is gated on an invite. Auth.js only calls
 * `createUser` for a brand-new OAuth identity (no matching account row, no
 * matching email), so this is exactly the "joining" event to guard. A valid,
 * unclaimed, unexpired invite code arrives via the signed httpOnly cookie set
 * by `beginOAuthSignIn`; without one we throw and Auth.js redirects to the
 * sign-in page with `?error=AccessDenied`.
 */
class OAuthInviteRequired extends AuthError {
  static readonly type = "AccessDenied";
}

const baseAdapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

const adapter: typeof baseAdapter = {
  ...baseAdapter,
  async createUser(data) {
    const [{ value: userCount }] = await db
      .select({ value: count() })
      .from(users);
    const isBootstrap = userCount === 0;

    let inviteId: string | null = null;
    if (!isBootstrap) {
      const code = await readOAuthInviteCookie();
      const invite = code ? await findRedeemableInvite(code) : null;
      if (!invite) {
        await clearOAuthInviteCookie();
        throw new OAuthInviteRequired(
          "A valid invite code is required to join.",
        );
      }
      inviteId = invite.id;
    }

    // Prefer the OAuth profile name (decision: it wins), else whatever came
    // through. Role follows the same bootstrap rule as password registration.
    const bootstrapEmail = process.env.MEMORIA_BOOTSTRAP_EMAIL?.toLowerCase();
    const email = (data.email ?? "").toLowerCase();
    const role =
      isBootstrap || (bootstrapEmail && email === bootstrapEmail)
        ? ("admin" as const)
        : ("member" as const);

    const [user] = await db
      .insert(users)
      .values({
        name: data.name ?? null,
        email,
        image: data.image ?? null,
        role,
      })
      .returning();

    if (inviteId) {
      const won = await claimInvite(inviteId, user.id);
      await clearOAuthInviteCookie();
      if (!won) {
        // Lost a race for the code: roll back the just-created user so the
        // invite cannot be double-spent.
        await db.delete(users).where(eq(users.id, user.id));
        throw new OAuthInviteRequired(
          "That invite code was just used by someone else.",
        );
      }
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
    };
  },
};

/** OAuth providers are only registered when their env credentials exist. */
function oauthProviders(): Provider[] {
  const list: Provider[] = [];
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    list.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
      }),
    );
  }
  return list;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  // Database sessions are not supported alongside the Credentials provider,
  // so role and id are carried on the JWT instead.
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  providers: [
    ...oauthProviders(),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await db.query.users.findFirst({
          where: eq(users.email, email.toLowerCase()),
        });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: "admin" | "member" }).role ?? "member";
      } else if (token.id) {
        // OAuth sign-ins do not pass through `authorize`, so refresh the role
        // from the database to keep the JWT accurate for every provider.
        const row = await db.query.users.findFirst({
          where: eq(users.id, token.id as string),
          columns: { role: true },
        });
        token.role = row?.role ?? "member";
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      session.user.role = (token.role as "admin" | "member") ?? "member";
      return session;
    },
  },
});
