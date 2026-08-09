import Link from "next/link";
import type { Metadata } from "next";
import { apiGetRequired } from "@/lib/api-client";
import { allOAuthProviders } from "@/lib/oauth-providers";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Join" };

// The bootstrap-vs-invite copy depends on whether any user exists yet, so
// render per-request instead of prerendering (which would query the DB at
// build time and freeze the mode from whatever the build database held).
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const { bootstrap } = await apiGetRequired<{ bootstrap: boolean }>("/api/bootstrap");

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            {bootstrap ? "Set up Memoria" : "Join the vault"}
            <span className="text-accent">.</span>
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {bootstrap
              ? "This first account becomes the family admin."
              : "Enter the invite code a family admin gave you."}
          </p>
        </div>

        <RegisterForm
          requiresInvite={!bootstrap}
          oauthProviders={allOAuthProviders()}
        />

        <p className="mt-6 text-center text-sm text-ink-faint">
          Already have an account?{" "}
          <Link href="/signin" className="link-red">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
