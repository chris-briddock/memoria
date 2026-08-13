import type { Metadata } from "next";
import Link from "next/link";
import { apiGetRequired } from "@/lib/api-client";
import type { SessionUser } from "@/lib/types";
import { enabledOAuthProviders } from "@/lib/oauth-providers";
import { SignInMethods } from "./sign-in-methods";
import { ProfileSection } from "./profile-section";
import { CloudConnections, type CloudConnectionStatus } from "./cloud-connections";

export const metadata: Metadata = { title: "Settings" };

type SignInMethodsData = {
  hasPassword: boolean;
  providers: string[];
};

type ImportStatus = {
  providers: CloudConnectionStatus[];
  surfaces: unknown[];
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, signInMethods, importStatus, params] = await Promise.all([
    apiGetRequired<SessionUser>("/api/me"),
    apiGetRequired<SignInMethodsData>("/api/me/sign-in-methods"),
    apiGetRequired<ImportStatus>("/api/import"),
    searchParams,
  ]);
  const isAdmin = user.role === "admin";
  const importConnected = typeof params.import_connected === "string" ? params.import_connected : null;
  const importError = typeof params.import_error === "string" ? params.import_error : null;

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

      {importConnected && (
        <p role="status" className="card px-5 py-3.5 text-sm text-ink">
          Cloud storage connected ({
            importStatus.providers.find((p) => p.id === importConnected)?.label ??
            importConnected
          }). You can now{" "}
          <Link href="/import" className="text-accent underline underline-offset-2">
            import photos
          </Link>
          .
        </p>
      )}
      {importError && (
        <p role="alert" className="card px-5 py-3.5 text-sm text-accent">
          Could not connect cloud storage: {importError}
        </p>
      )}

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

      <section className="space-y-4">
        <h2 className="font-display text-lg font-medium tracking-tight">
          Cloud imports
        </h2>
        <p className="text-sm text-ink-soft">
          Connect Google Drive, Google Photos, or OneDrive to import photos
          into the vault. Disconnecting only removes Memoria&rsquo;s access
          &mdash; photos already imported stay in the vault.
        </p>
        <CloudConnections connections={importStatus.providers} />
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
