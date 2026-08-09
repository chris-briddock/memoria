"use client";

import { useState } from "react";
import Link from "next/link";
import type { OAuthProviderId } from "@/lib/oauth-providers";
import { apiSubmit } from "@/lib/api-submit";

function UnlinkButton({
  pending,
  onClick,
}: Readonly<{ pending: boolean; onClick: (e: React.MouseEvent) => void }>) {
  return (
    <button
      type="button"
      className="btn-ghost text-sm"
      disabled={pending}
      onClick={onClick}
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}

function UnlinkForm({ provider }: Readonly<{ provider: OAuthProviderId }>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlink() {
    if (!confirm("Remove this sign-in method from your account?")) return;
    setPending(true);
    setError(null);
    const result = await apiSubmit(`/api/me?provider=${provider}`, {
      method: "DELETE",
    });
    setPending(false);
    if (!result.ok) setError(result.error ?? "Could not remove provider.");
  }

  return (
    <span className="flex items-center gap-3">
      {error && (
        <p role="alert" className="text-xs text-accent">
          {error}
        </p>
      )}
      <UnlinkButton pending={pending} onClick={handleUnlink} />
    </span>
  );
}

/**
 * The current account's sign-in methods: password plus any linked OAuth
 * providers. Linking starts an OAuth redirect (Auth.js links the identity to
 * the active session automatically); unlinking is guarded server-side so the
 * account always keeps at least one working sign-in method.
 *
 * Linking stays navigation-based (a GET to /api/oauth/link which throws the
 * provider redirect the browser must follow). Unlinking is a JSON DELETE to
 * /api/me.
 */
export function SignInMethods({
  hasPassword,
  linkedProviders,
  availableProviders,
}: Readonly<{
  hasPassword: boolean;
  linkedProviders: string[];
  availableProviders: { id: OAuthProviderId; label: string }[];
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
              <UnlinkForm provider={p.id} />
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
              <Link
                key={p.id}
                href={`/api/oauth/link?provider=${p.id}`}
                className="btn-ghost text-sm"
              >
                Link {p.label}
              </Link>
            ))}
          </span>
        </li>
      )}
    </ul>
  );
}
