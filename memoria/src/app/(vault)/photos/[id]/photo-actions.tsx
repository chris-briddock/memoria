"use client";

import { useState, useTransition } from "react";
import { deletePhoto, toggleFavorite, updateCaption } from "@/lib/actions/photos";

export function PhotoActions({
  photoId,
  favorite,
  caption,
  canDelete,
}: Readonly<{
  photoId: string;
  favorite: boolean;
  caption: string | null;
  canDelete: boolean;
}>) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div className="space-y-3">
      <form
        action={async (formData) => {
          await updateCaption(photoId, formData);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }}
        className="space-y-2"
      >
        <label htmlFor="caption" className="text-sm font-medium text-ink-soft">
          Caption
        </label>
        <textarea
          id="caption"
          name="caption"
          rows={2}
          defaultValue={caption ?? ""}
          placeholder="Who's in this photo? Where was it taken?"
          className="field resize-y"
        />
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-ghost">
            Save caption
          </button>
          {saved && <span className="text-xs text-ink-faint">Saved</span>}
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost"
          disabled={isPending}
          aria-pressed={favorite}
          onClick={() =>
            startTransition(async () => {
              await toggleFavorite(photoId);
            })
          }
        >
          <svg
            viewBox="0 0 20 20"
            fill={favorite ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            className={`h-4 w-4 ${favorite ? "text-accent" : ""}`}
            aria-hidden
          >
            <path d="M10 1.7l2.47 5.18 5.68.72-4.17 3.95 1.08 5.62L10 14.36l-5.06 2.81 1.08-5.62-4.17-3.95 5.68-.72L10 1.7z" />
          </svg>
          {favorite ? "Favourite" : "Add to favourites"}
        </button>

        {canDelete &&
          (confirming ? (
            <>
              <button
                type="button"
                className="btn-ghost border-accent text-accent hover:border-accent hover:bg-accent-soft hover:text-accent"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await deletePhoto(photoId);
                  })
                }
              >
                Really delete
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          ))}
      </div>
    </div>
  );
}
