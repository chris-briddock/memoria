import NextAuth, { AuthError } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Provider } from "next-auth/providers";
import { db, getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import {
  claimInvite,
  clearOAuthInviteCookie,
  findRedeemableInvite,
  readOAuthInviteCookie,
} from "@/lib/oauth";
import { logger } from "@/lib/logger";

const log = logger("auth");

// Auth.js's signIn()/signOut() server actions build an internal absolute URL
// via createActionURL, which reads process.env.AUTH_URL first and only then
// falls back to reconstructing from incoming host/x-forwarded-host headers.
// On runtimes that invoke route handlers with a relative request URL (no host
// header), that fallback produces `protocol//undefined` and throws
// TypeError: Invalid URL (ERR_INVALID_URL) — exactly the production failure
// seen at /api/auth/signin. Fail fast and loudly here instead of a cryptic
// 500 at first login: AUTH_URL is required when serving in production.
// NEXT_PHASE is set during `next build` (when NODE_ENV is also production but
// no AUTH_URL is configured for page-data collection) — only enforce this
// when the server is actually running and accepting requests.
if (
  process.env.NODE_ENV === "production" &&
  !process.env.NEXT_PHASE &&
  !process.env.AUTH_URL &&
  !process.env.NEXTAUTH_URL
) {
  throw new Error(
    "AUTH_URL must be set in production (e.g. https://your-domain). " +
      "Auth.js cannot reconstruct the site origin and would throw Invalid URL on sign-in.",
  );
}

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

// The adapter inspects the client instance's prototype chain to detect the
// database flavour, so it needs the real PgDatabase — not the lazy `db` proxy.
// Build it lazily: this module is imported during `next build` page-data
// collection, when DATABASE_URL is not set, so the client (and the pool behind
// it) must not be created until Auth.js actually invokes an adapter method.
type BaseAdapter = ReturnType<typeof DrizzleAdapter>;
let baseAdapter: BaseAdapter | undefined;
function getBaseAdapter(): BaseAdapter {
  baseAdapter ??= DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });
  return baseAdapter;
}

// Auth.js's init() enumerates the adapter with Object.keys() and rebuilds it
// as `Object.keys(adapter).reduce(...)`, wrapping each method with
// error-handling + debug logging. A Proxy over `{}` has no ownKeys trap and
// enumerates to an empty object, so every method except the one Auth.js reads
// directly would go missing — the proxy previously here lost getUserByAccount
// this way, blowing up the OAuth callback with "getUserByAccount is not a
// function". The adapter must therefore be a plain object with own,
// enumerable keys for every method the base adapter exposes. We still
// delegate at call time so the real DrizzleAdapter (and its pool) is only
// built once Auth.js actually invokes a method — importing this module must
// not require DATABASE_URL during `next build` page-data collection.
const ADAPTER_METHODS = [
  "createUser",
  "getUser",
  "getUserByEmail",
  "getUserByAccount",
  "updateUser",
  "deleteUser",
  "linkAccount",
  "unlinkAccount",
  "getSessionAndUser",
  "createSession",
  "updateSession",
  "deleteSession",
  "createVerificationToken",
  "useVerificationToken",
  "getAccount",
] as const satisfies readonly (keyof BaseAdapter)[];

const adapter: BaseAdapter = Object.fromEntries(
  ADAPTER_METHODS.map((name) => [
    name,
    name === "createUser"
      ? createUserWithInviteGate
      : (...args: unknown[]) => {
          const base = getBaseAdapter() as Record<
            string,
            (...a: unknown[]) => unknown
          >;
          return base[name](...args);
        },
  ]),
) as unknown as BaseAdapter;

// createUser is overridden to gate OAuth account creation on an invite; the
// rest of the adapter delegates to the lazily-built base.
async function createUserWithInviteGate(
  data: Parameters<NonNullable<BaseAdapter["createUser"]>>[0],
) {
    // Existence check, not COUNT(*): the bootstrap decision only needs to
    // know if the users table is empty. COUNT(*) forces a full table scan
    // (Postgres MVCC can't satisfy it from an index), which gets expensive
    // as the vault grows; LIMIT 1 returns instantly and stays O(1).
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    const isBootstrap = existing.length === 0;

    let inviteId: string | null = null;
    if (!isBootstrap) {
      const code = await readOAuthInviteCookie();
      if (!code) {
        log.warn("oauth account creation rejected: no invite cookie present");
        await clearOAuthInviteCookie();
        throw new OAuthInviteRequired(
          "A valid invite code is required to join.",
        );
      }
      const invite = await findRedeemableInvite(code);
      if (!invite) {
        log.warn("oauth account creation rejected: invite not redeemable");
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
        log.warn("oauth invite claim lost to a race; rolling back user", {
          user_id: user.id,
          invite_id: inviteId,
        });
        await db.delete(users).where(eq(users.id, user.id));
        throw new OAuthInviteRequired(
          "That invite code was just used by someone else.",
        );
      }
    }

    log.info("oauth user created", {
      user_id: user.id,
      role,
      is_bootstrap: isBootstrap,
      used_invite: Boolean(inviteId),
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
    };
}

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
        if (!parsed.success) {
          log.warn("credentials sign-in rejected: malformed payload");
          return null;
        }

        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase();
        const user = await db.query.users.findFirst({
          where: eq(users.email, normalizedEmail),
        });
        if (!user?.passwordHash) {
          // Never log passwords; whether the email exists is deliberately not
          // distinguished in the message so the log can't be a user-enumeration
          // oracle beyond what the timing already leaks.
          log.warn("credentials sign-in failed: unknown email or no password set");
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          log.warn("credentials sign-in failed: wrong password", {
            user_id: user.id,
          });
          return null;
        }

        log.info("credentials sign-in succeeded", {
          user_id: user.id,
          role: user.role,
        });
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
        log.debug("jwt issued", {
          user_id: token.id as string,
          role: token.role as string,
        });
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
