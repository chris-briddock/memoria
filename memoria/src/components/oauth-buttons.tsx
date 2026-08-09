"use client";

import { useFormStatus } from "react-dom";
import type { OAuthProviderId } from "@/lib/oauth-providers";

export type OAuthProviderInfo = {
  id: OAuthProviderId;
  label: string;
};

function ProviderButton({
  provider,
  label,
}: Readonly<{ provider: string; label: string }>) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="provider"
      value={provider}
      className="btn-ghost w-full"
      disabled={pending}
    >
      {pending ? "Redirecting…" : label}
    </button>
  );
}

/**
 * Renders one submit button per *configured* OAuth provider, posting to
 * `/api/oauth/signin` (a route handler that throws the provider redirect the
 * browser must follow — it cannot be a fetch() call). The optional
 * `inviteCode` / `next` hidden fields let the register flow carry an invite
 * through the OAuth round-trip. Nothing renders if no provider is configured,
 * so the UI degrades to password-only.
 *
 * The form uses a normal navigation submit (no `fetch` interceptor) so the
 * browser follows Auth.js's 302 to the provider and back. Any inline error
 * (bad invite, provider unconfigured) comes back as JSON only if the route
 * cannot start the redirect — in that case the route returns 4xx and the
 * browser shows it; we do not intercept because the success path must be a
 * full navigation.
 */
export function OAuthButtons({
  providers,
  verb = "Continue",
  inviteCode,
  next,
}: Readonly<{
  providers: OAuthProviderInfo[];
  verb?: string;
  inviteCode?: string;
  next?: string;
}>) {
  if (providers.length === 0) return null;

  return (
    <form action="/api/oauth/signin" method="post" className="space-y-2">
      {inviteCode !== undefined && (
        <input type="hidden" name="inviteCode" value={inviteCode} />
      )}
      {next !== undefined && <input type="hidden" name="next" value={next} />}
      {providers.map((p) => (
        <ProviderButton
          key={p.id}
          provider={p.id}
          label={`${verb} with ${p.label}`}
        />
      ))}
    </form>
  );
}
