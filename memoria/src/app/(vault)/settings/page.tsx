import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { listSignInMethods } from "@/lib/queries";
import { enabledOAuthProviders } from "@/lib/oauth-providers";
import { SignInMethods } from "./sign-in-methods";
import { ProfileSection } from "./profile-section";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await verifySession();
  const isAdmin = user.role === "admin";
  const signInMethods = await listSignInMethods();

  return (
    <div className="space-y-12">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Your profile and how you sign in to the vault.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="font-display text-lg font-medium tracking-tight">
          Profile
        </h2>
        <ProfileSection
          currentName={user.name}
          hasPassword={signInMethods.hasPassword}
        />
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-lg font-medium tracking-tight">
          Sign-in methods
        </h2>
        <p className="text-sm text-ink-soft">
          Link a provider to sign in without a password. You cannot remove your
          last sign-in method until a password is set.
        </p>
        <SignInMethods
          hasPassword={signInMethods.hasPassword}
          linkedProviders={signInMethods.providers}
          availableProviders={enabledOAuthProviders()}
        />
      </section>

      {isAdmin && (
        <section className="space-y-4">
          <h2 className="font-display text-lg font-medium tracking-tight">
            Family
          </h2>
          <p className="text-sm text-ink-soft">
            Manage invite codes and see who is in the vault.
          </p>
          <Link href="/settings/family" className="btn-ghost inline-block">
            Manage family
          </Link>
        </section>
      )}
    </div>
  );
}
