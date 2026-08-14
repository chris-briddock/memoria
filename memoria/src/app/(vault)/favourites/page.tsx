import type { Metadata } from "next";
import { listFavoritePhotos } from "@/lib/queries";
import { PhotoGrid } from "@/components/photo-grid";

export const metadata: Metadata = { title: "Favourites" };

export default async function FavouritesPage() {
  const photos = await listFavoritePhotos();

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Favourites
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {photos.length === 0
            ? "Star photos to gather them here."
            : `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`}
        </p>
      </header>

      {photos.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto h-8 w-8 text-ink-faint"
            aria-hidden
          >
            <path d="M12 2.6l2.96 6.22 6.82.86-5 4.74 1.28 6.75L12 17.7l-6.06 3.47L7.22 14.4l-5-4.74 6.82-.86L12 2.6z" />
          </svg>
          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">
            No favourites yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
            Open any photo and press{" "}
            <span className="italic">Add to favourites</span>, or star it from
            the grid, to collect it here.
          </p>
        </div>
      ) : (
        <PhotoGrid photos={photos} />
      )}
    </div>
  );
}
