"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction } from "@/lib/actions/auth";
import {
  OAuthButtons,
  type OAuthProviderInfo,
} from "@/components/oauth-buttons";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function SignInForm({
  next,
  oauthProviders,
}: Readonly<{ next?: string; oauthProviders: OAuthProviderInfo[] }>) {
  const [state, formAction] = useActionState(signInAction, undefined);

  return (
    <div className="space-y-4">
      <form action={formAction} className="card space-y-4 p-6">
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

      {state?.error && (
        <p role="alert" className="text-sm text-accent">
          {state.error}
        </p>
      )}

        <SubmitButton />
      </form>

      {oauthProviders.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span className="h-px flex-1 bg-line" />
            or
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
