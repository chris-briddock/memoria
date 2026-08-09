"use client";

import { useState } from "react";
import { apiSubmit } from "@/lib/api-submit";

/**
 * Display name and password management for the signed-in user.
 * Submits via PATCH /api/me (name) and POST /api/me (password), replacing the
 * `useActionState`/server-action pattern.
 */
export function ProfileSection({
  currentName,
  hasPassword,
}: Readonly<{
  currentName: string | null;
  hasPassword: boolean;
}>) {
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

function NameForm({ currentName }: Readonly<{ currentName: string | null }>) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setFeedback(null);

    const formData = new FormData(e.currentTarget);
    const result = await apiSubmit<{ success?: string }>(`/api/me`, {
      method: "PATCH",
      body: formData,
    });

    setPending(false);
    if (!result.ok) {
      setFeedback({ error: result.error ?? "Update failed." });
    } else {
      setFeedback({ success: result.data?.success ?? "Name updated." });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5">
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
      {feedback?.error && (
        <p role="alert" className="text-sm text-accent">
          {feedback.error}
        </p>
      )}
      {feedback?.success && (
        <p className="text-sm text-ink-faint">{feedback.success}</p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}

function PasswordForm({ hasPassword }: Readonly<{ hasPassword: boolean }>) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);

  let submitLabel = "Set password";
  if (pending) {
    submitLabel = "Saving…";
  } else if (hasPassword) {
    submitLabel = "Change password";
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    // Capture the form node synchronously: React nulls e.currentTarget once
    // the event is released, which happens after the await below.
    const form = e.currentTarget;
    setPending(true);
    setFeedback(null);

    const formData = new FormData(form);
    const result = await apiSubmit<{ success?: string }>(`/api/me`, {
      method: "POST",
      body: formData,
    });

    setPending(false);
    if (!result.ok) {
      setFeedback({ error: result.error ?? "Update failed." });
    } else {
      setFeedback({ success: result.data?.success ?? "Password saved." });
      form.reset();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5">
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
      {feedback?.error && (
        <p role="alert" className="text-sm text-accent">
          {feedback.error}
        </p>
      )}
      {feedback?.success && (
        <p className="text-sm text-ink-faint">{feedback.success}</p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {submitLabel}
      </button>
    </form>
  );
}
