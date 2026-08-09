"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiSubmit } from "@/lib/api-submit";

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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  const [favState, setFavState] = useState(favorite);

  async function handleCaption(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const result = await apiSubmit(`/api/photos/${photoId}`, {
      method: "PATCH",
      body: formData,
    });
    if (!result.ok) return;
    // The <h1> caption is server-rendered from the photo detail, so refresh
    // the route's server data to reflect the new value without a full reload.
    router.refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleFavorite() {
    startTransition(async () => {
      const result = await apiSubmit<{ favorite: boolean }>(
        `/api/photos/${photoId}/favorite`,
        { method: "POST" },
      );
      if (result.ok && result.data) {
        setFavState(result.data.favorite);
      }
    });
  }

  async function handleDelete() {
    startTransition(async () => {
      const result = await apiSubmit<{ redirect?: string }>(
        `/api/photos/${photoId}`,
        { method: "DELETE" },
      );
      if (result.ok && result.data?.redirect) {
        router.push(result.data.redirect);
      }
    });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleCaption} className="space-y-2">
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
          aria-pressed={favState}
          onClick={handleFavorite}
        >
          <svg
            viewBox="0 0 20 20"
            fill={favState ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            className={`h-4 w-4 ${favState ? "text-accent" : ""}`}
            aria-hidden
          >
            <path d="M10 1.7l2.47 5.18 5.68.72-4.17 3.95 1.08 5.62L10 14.36l-5.06 2.81 1.08-5.62-4.17-3.95 5.68-.72L10 1.7z" />
          </svg>
          {favState ? "Favourite" : "Add to favourites"}
        </button>

        {canDelete &&
          (confirming ? (
            <>
              <button
                type="button"
                className="btn-ghost border-accent text-accent hover:border-accent hover:bg-accent-soft hover:text-accent"
                disabled={isPending}
                onClick={handleDelete}
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
