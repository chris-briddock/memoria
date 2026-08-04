"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { UnlinkResult } from "@/lib/action-types";
import type { OAuthProviderId } from "@/lib/oauth-providers";

function UnlinkButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-ghost text-sm"
      disabled={pending}
      onClick={(e) => {
        if (!confirm("Remove this sign-in method from your account?")) {
          e.preventDefault();
        }
      }}
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}

function UnlinkForm({
  provider,
  unlink,
}: Readonly<{
  provider: OAuthProviderId;
  unlink: (provider: OAuthProviderId) => Promise<UnlinkResult>;
}>) {
  const [state, formAction] = useActionState<UnlinkResult, void>(
    () => unlink(provider),
    undefined,
  );
  return (
    <form action={() => formAction()} className="flex items-center gap-3">
      {state?.error && (
        <p role="alert" className="text-xs text-accent">
          {state.error}
        </p>
      )}
      <UnlinkButton />
    </form>
  );
}

function LinkButton({ label }: Readonly<{ label: string }>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-ghost text-sm" disabled={pending}>
      {pending ? "Redirecting…" : `Link ${label}`}
    </button>
  );
}

/**
 * The current account's sign-in methods: password plus any linked OAuth
 * providers. Linking starts an OAuth redirect (Auth.js links the identity to
 * the active session automatically); unlinking is guarded server-side so the
 * account always keeps at least one working sign-in method.
 */
export function SignInMethods({
  hasPassword,
  linkedProviders,
  availableProviders,
  linkProvider,
  unlinkProvider,
}: Readonly<{
  hasPassword: boolean;
  linkedProviders: string[];
  availableProviders: { id: OAuthProviderId; label: string }[];
  /** Server actions, passed by the server page so this bundle never imports them. */
  linkProvider: (provider: OAuthProviderId) => Promise<void>;
  unlinkProvider: (provider: OAuthProviderId) => Promise<UnlinkResult>;
}>) {
  const linkable = availableProviders.filter(
    (p) => !linkedProviders.includes(p.id),
  );

  return (
    <ul className="card divide-y divide-line">
      <li className="flex items-center gap-3 px-5 py-3.5">
        <p className="text-sm font-medium">Password</p>
        {hasPassword ? (
          <span className="ml-auto text-xs text-ink-faint">Set</span>
        ) : (
          <span className="ml-auto text-xs text-ink-faint">Not set</span>
        )}
      </li>

      {availableProviders.map((p) => {
        const linked = linkedProviders.includes(p.id);
        if (!linked) return null;
        return (
          <li key={p.id} className="flex items-center gap-3 px-5 py-3.5">
            <p className="text-sm font-medium">{p.label}</p>
            <span className="text-xs text-ink-faint">Linked</span>
            <span className="ml-auto">
              <UnlinkForm provider={p.id} unlink={unlinkProvider} />
            </span>
          </li>
        );
      })}

      {linkable.length > 0 && (
        <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <p className="text-sm text-ink-soft">
            Link {linkable.map((p) => p.label).join(" or ")} to sign in without
            a password.
          </p>
          <span className="ml-auto flex gap-2">
            {linkable.map((p) => (
              <form key={p.id} action={() => linkProvider(p.id)}>
                <LinkButton label={p.label} />
              </form>
            ))}
          </span>
        </li>
      )}
    </ul>
  );
}
