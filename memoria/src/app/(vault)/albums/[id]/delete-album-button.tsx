"use client";

import { useState, useTransition } from "react";
import { deleteAlbum } from "@/lib/actions/photos";

export function DeleteAlbumButton({ albumId }: Readonly<{ albumId: string }>) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

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
            await deleteAlbum(albumId);
          })
        }
      >
        Delete
      </button>
      <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </div>
  );
}
