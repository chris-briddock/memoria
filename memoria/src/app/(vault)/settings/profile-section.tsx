"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  changePassword,
  updateName,
  type ProfileResult,
} from "@/lib/actions/account";

function SaveButton({ label, pendingLabel }: Readonly<{ label: string; pendingLabel: string }>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: Readonly<{ state: ProfileResult }>) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-accent">
        {state.error}
      </p>
    );
  }
  if (state?.success) {
    return <p className="text-sm text-ink-faint">{state.success}</p>;
  }
  return null;
}

function NameForm({ currentName }: Readonly<{ currentName: string | null }>) {
  const [state, formAction] = useActionState<ProfileResult, FormData>(
    updateName,
    undefined,
  );
  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div className="space-y-1.5">
        <label htmlFor="profile-name" className="text-sm font-medium text-ink-soft">
          Your name
        </label>
        <input
          id="profile-name"
          name="name"
          required
          maxLength={80}
          defaultValue={currentName ?? ""}
          className="field"
          placeholder="Chris"
        />
      </div>
      <Feedback state={state} />
      <SaveButton label="Save name" pendingLabel="Saving…" />
    </form>
  );
}

function PasswordForm({ hasPassword }: Readonly<{ hasPassword: boolean }>) {
  const [state, formAction] = useActionState<ProfileResult, FormData>(
    changePassword,
    undefined,
  );
  return (
    <form action={formAction} className="card space-y-4 p-5">
      {hasPassword && (
        <div className="space-y-1.5">
          <label htmlFor="current-password" className="text-sm font-medium text-ink-soft">
            Current password
          </label>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            className="field"
          />
        </div>
      )}
      {!hasPassword && (
        <p className="text-sm text-ink-soft">
          No password is set yet — set one to sign in without a provider and to
          be able to remove a linked provider.
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="new-password" className="text-sm font-medium text-ink-soft">
          New password
        </label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className="field"
        />
        <p className="text-xs text-ink-faint">At least 10 characters.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirm-password" className="text-sm font-medium text-ink-soft">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className="field"
        />
      </div>
      <Feedback state={state} />
      <SaveButton
        label={hasPassword ? "Change password" : "Set password"}
        pendingLabel="Saving…"
      />
    </form>
  );
}

/** Display name and password management for the signed-in user. */
export function ProfileSection({
  currentName,
  hasPassword,
}: Readonly<{ currentName: string | null; hasPassword: boolean }>) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-ink-soft">Display name</h3>
        <NameForm currentName={currentName} />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-ink-soft">
          {hasPassword ? "Change password" : "Set a password"}
        </h3>
        <PasswordForm hasPassword={hasPassword} />
      </div>
    </div>
  );
}
