"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { beginOAuthSignIn, type FormState } from "@/lib/actions/auth";
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
 * `beginOAuthSignIn`. The server component decides which providers to show
 * (env-gated) and passes them in; the optional `inviteCode` / `next` hidden
 * fields let the register flow carry an invite through the OAuth round-trip.
 * Nothing renders if no provider is configured, so the UI degrades to
 * password-only.
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
  const [state, formAction] = useActionState<FormState, FormData>(
    beginOAuthSignIn,
    undefined,
  );
  if (providers.length === 0) return null;

  return (
    <form action={formAction} className="space-y-2">
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
      {state?.error && (
        <p role="alert" className="text-sm text-accent">
          {state.error}
        </p>
      )}
    </form>
  );
}
