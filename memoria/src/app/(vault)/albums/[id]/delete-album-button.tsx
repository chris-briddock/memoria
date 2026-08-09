"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiSubmit } from "@/lib/api-submit";

export function DeleteAlbumButton({
  albumId,
}: Readonly<{ albumId: string }>) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setConfirming(true)}>
        Delete album
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-ink-soft">Photos are kept.</span>
      <button
        type="button"
        className="btn-ghost border-accent text-accent hover:bg-accent-soft hover:text-accent"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await apiSubmit(`/api/albums/${albumId}`, {
              method: "DELETE",
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if (result.data && typeof result.data === "object" && "redirect" in result.data) {
              router.push((result.data as { redirect: string }).redirect);
            }
          })
        }
      >
        Delete
      </button>
      <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
        Cancel
      </button>
      {error && (
        <span className="text-sm text-accent">{error}</span>
      )}
    </div>
  );
}
