"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  OAuthButtons,
  type OAuthProviderInfo,
} from "@/components/oauth-buttons";
import { apiSubmit } from "@/lib/api-submit";

export function SignInForm({
  next,
  oauthProviders,
}: Readonly<{
  next?: string;
  oauthProviders: OAuthProviderInfo[];
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await apiSubmit<{ redirect?: string }>(`/api/auth/signin`, {
      body: formData,
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Sign in failed.");
    } else if (result.data?.redirect) {
      router.push(result.data.redirect);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="card space-y-4 p-6">
        <input type="hidden" name="next" value={next ?? "/"} />

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium text-ink-soft">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="field"
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-ink-soft">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="field"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-accent">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {oauthProviders.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span className="h-px flex-1 bg-line" />
            <span>or</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="card p-6">
            <OAuthButtons
              providers={oauthProviders}
              verb="Sign in"
              next={next ?? "/"}
            />
          </div>
        </>
      )}
    </div>
  );
}
