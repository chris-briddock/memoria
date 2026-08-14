"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiSubmit } from "@/lib/api-submit";

type PickerPhoto = {
  id: string;
  caption: string | null;
  originalFilename: string;
  width: number | null;
  height: number | null;
};

/**
 * Checkbox grid for filing already-uploaded photos into this album without
 * visiting each photo's detail page. Membership flips are optimistic; the
 * server is authoritative on refresh.
 */
export function AlbumPhotoPicker({
  albumId,
  photos,
  memberOf,
}: Readonly<{
  albumId: string;
  photos: PickerPhoto[];
  memberOf: string[];
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [optimisticMembership, toggleOptimistic] = useOptimistic(
    memberOf,
    (current: string[], photoId: string) =>
      current.includes(photoId)
        ? current.filter((id) => id !== photoId)
        : [...current, photoId],
  );

  if (!open) {
    return (
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen(true)}
        aria-expanded="false"
      >
        Add photos
      </button>
    );
  }

  return (
    <section
      aria-label="Add photos to this album"
      className="card space-y-4 p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-medium tracking-wider text-ink-faint uppercase">
          Add photos to this album
        </h2>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setOpen(false)}
          aria-expanded="true"
          disabled={isPending}
        >
          Done
        </button>
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-ink-faint">
          There are no photos in the vault yet. Upload some first, then come
          back to file them here.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {photos.map((photo) => {
            const checked = optimisticMembership.includes(photo.id);
            return (
              <li key={photo.id}>
                <label className="group relative block cursor-pointer overflow-hidden rounded-sm bg-paper-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/photos/${photo.id}/thumb`}
                    alt=""
                    loading="lazy"
                    style={
                      photo.width && photo.height
                        ? { aspectRatio: `${photo.width} / ${photo.height}` }
                        : undefined
                    }
                    className={`h-auto w-full object-cover motion-safe:transition ${
                      photo.width && photo.height ? "" : "aspect-square"
                    } ${checked ? "opacity-90" : "opacity-60 group-hover:opacity-90"}`}
                  />
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isPending}
                    className="sr-only"
                    aria-label={photo.caption || photo.originalFilename}
                    onChange={() =>
                      startTransition(async () => {
                        toggleOptimistic(photo.id);
                        const result = await apiSubmit(
                          `/api/photos/${photo.id}/albums`,
                          {
                            method: checked ? "DELETE" : "POST",
                            body: JSON.stringify({ albumId }),
                          },
                        );
                        if (result.ok) router.refresh();
                      })
                    }
                  />
                  <span
                    aria-hidden
                    className={`absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full transition ${
                      checked
                        ? "bg-accent text-paper"
                        : "bg-scrim/55 text-transparent ring-1 ring-paper/80"
                    }`}
                  >
                    <svg
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3 w-3"
                    >
                      <path d="M2 6.5l2.5 2.5L10 3" />
                    </svg>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
