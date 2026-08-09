"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSubmit } from "@/lib/api-submit";

/**
 * Inline "Create album" form. Submits via POST /api/albums and navigates to
 * the new album on success. Replaces the server-action `<form action={createAlbum}>`.
 */
export function CreateAlbumForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await apiSubmit<{ id: string; redirect?: string }>(
      "/api/albums",
      { body: formData },
    );

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (result.data?.redirect) {
      router.push(result.data.redirect);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-wrap gap-3 p-5">
      <input
        name="name"
        required
        placeholder="Album name"
        className="field flex-1 basis-48"
      />
      <input
        name="description"
        placeholder="Description (optional)"
        className="field flex-1 basis-64"
      />
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create album"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-accent">
          {error}
        </p>
      )}
    </form>
  );
}
