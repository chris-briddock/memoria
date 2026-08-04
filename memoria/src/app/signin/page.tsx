import Link from "next/link";
import type { Metadata } from "next";
import { count } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { allOAuthProviders } from "@/lib/oauth-providers";
import { signInAction, beginOAuthSignIn } from "@/lib/actions/auth";
import { SignInForm } from "./signin-form";

export const metadata: Metadata = { title: "Sign in" };

// The empty-vault copy depends on the live user count, so render per-request
// instead of prerendering (which would query the DB at build time).
export const dynamic = "force-dynamic";

/** Friendly messages for errors Auth.js appends to the error page URL. */
function oauthErrorMessage(error?: string): string | null {
  switch (error) {
    case "AccessDenied":
      return "A valid invite code is required to join. Ask a family admin for one.";
    case "OAuthAccountNotLinked":
      return "That account is already linked to a different sign-in method. Sign in with your usual method first, then link providers in Family settings.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
    case "Configuration":
      return "Sign-in with that provider failed. Please try again or use your password.";
    default:
      return null;
  }
}

export default async function SignInPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ next?: string; error?: string }>;
}>) {
  const { next, error } = await searchParams;
  const errorMessage = oauthErrorMessage(error);

  // On a brand new vault there is nobody to sign in as, so point at setup.
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Memoria<span className="text-accent">.</span>
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {userCount === 0
              ? "Let's set up your family vault."
              : "The family photo vault."}
          </p>
        </div>

        {userCount === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-ink-soft">
              No accounts exist yet. Create the first one to become the family
              admin.
            </p>
            <Link href="/register" className="btn-primary mt-4 w-full">
              Create the first account
            </Link>
          </div>
        ) : (
          <>
            {errorMessage && (
              <p role="alert" className="card mb-4 border-accent/40 p-4 text-sm text-accent">
                {errorMessage}
              </p>
            )}
            <SignInForm
              next={next}
              oauthProviders={allOAuthProviders()}
              signIn={signInAction}
              beginOAuth={beginOAuthSignIn}
            />
            <p className="mt-6 text-center text-sm text-ink-faint">
              Have an invite code?{" "}
              <Link href="/register" className="link-red">
                Join the vault
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
