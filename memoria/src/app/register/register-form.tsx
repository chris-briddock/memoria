"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { registerAction } from "@/lib/actions/auth";
import {
  OAuthButtons,
  type OAuthProviderInfo,
} from "@/components/oauth-buttons";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? "Creating account…" : "Create account"}
    </button>
  );
}

export function RegisterForm({
  requiresInvite,
  oauthProviders,
}: Readonly<{ requiresInvite: boolean; oauthProviders: OAuthProviderInfo[] }>) {
  const [state, formAction] = useActionState(registerAction, undefined);
  // Controlled so the OAuth buttons can carry the same code through sign-in.
  const [inviteCode, setInviteCode] = useState("");

  return (
    <div className="space-y-4">
      <form action={formAction} className="card space-y-4 p-6">
        {requiresInvite && (
          <div className="space-y-1.5">
            <label htmlFor="inviteCode" className="text-sm font-medium text-ink-soft">
              Invite code
            </label>
            <input
              id="inviteCode"
              name="inviteCode"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="field font-mono tracking-wider uppercase"
              placeholder="XXXX-XXXX-XXXX"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="name" className="text-sm font-medium text-ink-soft">
            Your name
          </label>
          <input id="name" name="name" required className="field" placeholder="Chris" />
        </div>

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
            autoComplete="new-password"
            required
            minLength={10}
            className="field"
          />
          <p className="text-xs text-ink-faint">At least 10 characters.</p>
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
            or join with
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="card space-y-3 p-6">
            {/*
             * The OAuth buttons post to beginOAuthSignIn. The controlled invite
             * code travels as a hidden field inside that form, then through the
             * OAuth round-trip in a signed cookie, so the adapter can claim it
             * when the account is created. The OAuth profile's name wins over
             * the form's name field.
             */}
            <OAuthButtons
              providers={oauthProviders}
              verb="Continue"
              inviteCode={inviteCode}
            />
            <p className="text-xs text-ink-faint">
              {requiresInvite
                ? "Uses the invite code above; your name comes from your provider profile."
                : "Your name comes from your provider profile."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
