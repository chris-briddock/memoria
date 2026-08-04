"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";

export function AlbumPicker({
  photoId,
  albums,
  memberOf,
  setPhotoAlbum,
}: Readonly<{
  photoId: string;
  albums: { id: string; name: string }[];
  memberOf: string[];
  /** Server action, passed by the server page so this bundle never imports it. */
  setPhotoAlbum: (
    photoId: string,
    albumId: string,
    shouldBeIn: boolean,
  ) => Promise<void>;
}>) {
  const [, startTransition] = useTransition();
  const [optimisticMembership, toggleOptimistic] = useOptimistic(
    memberOf,
    (current: string[], albumId: string) =>
      current.includes(albumId)
        ? current.filter((id) => id !== albumId)
        : [...current, albumId],
  );

  if (albums.length === 0) {
    return (
      <p className="border-t border-line pt-4 text-sm text-ink-faint">
        No albums yet.{" "}
        <Link href="/albums" className="link-red">
          Create one
        </Link>{" "}
        to start grouping photos.
      </p>
    );
  }

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <h2 className="text-[11px] font-medium tracking-wider text-ink-faint uppercase">
        Albums
      </h2>
      <ul className="space-y-1">
        {albums.map((album) => {
          const checked = optimisticMembership.includes(album.id);
          return (
            <li key={album.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm transition hover:bg-paper-raised">
                <input
                  type="checkbox"
                  checked={checked}
                  className="accent-[var(--accent)]"
                  onChange={() =>
                    startTransition(async () => {
                      toggleOptimistic(album.id);
                      await setPhotoAlbum(photoId, album.id, !checked);
                    })
                  }
                />
                <span>{album.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
