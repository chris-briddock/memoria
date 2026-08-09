"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSubmit } from "@/lib/api-submit";

export function CreateInviteForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    // Capture the form node synchronously: React nulls e.currentTarget once
    // the event is released, which happens after the await below.
    const form = e.currentTarget;
    setPending(true);
    setError(null);

    const formData = new FormData(form);
    const result = await apiSubmit(`/api/invites`, { body: formData });

    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create invite.");
    } else {
      form.reset();
      router.refresh();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="card flex flex-wrap gap-3 p-5"
    >
      <input
        name="note"
        placeholder="Who is this for? (optional)"
        className="field flex-1 basis-64"
      />
      {error && (
        <p role="alert" className="basis-full text-sm text-accent">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create invite"}
      </button>
    </form>
  );
}
