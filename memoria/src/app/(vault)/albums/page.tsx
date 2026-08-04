import Link from "next/link";
import type { Metadata } from "next";
import { listAlbums } from "@/lib/queries";
import { createAlbum } from "@/lib/actions/photos";

export const metadata: Metadata = { title: "Albums" };

export default async function AlbumsPage() {
  const albums = await listAlbums();

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Albums
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Group photos by holiday, year, or whoever&rsquo;s in them.
        </p>
      </header>

      <form action={createAlbum} className="card flex flex-wrap gap-3 p-5">
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
        <button type="submit" className="btn-primary">
          Create album
        </button>
      </form>

      {albums.length === 0 ? (
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
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20V4a2 2 0 00-2-2H6.5A2.5 2.5 0 004 4.5v15z" />
            <path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5" />
          </svg>
          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">
            No albums yet
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Create one above, then add photos to it from any photo&rsquo;s page.
          </p>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((album) => (
            <li key={album.id}>
              <Link
                href={`/albums/${album.id}`}
                className="card group block overflow-hidden motion-safe:transition hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <div className="aspect-[4/3] bg-paper">
                  {album.coverPhotoId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/photos/${album.coverPhotoId}/thumb`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-ink-faint">
                      Empty
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <h2 className="font-display text-lg font-medium tracking-tight">
                    {album.name}
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-faint">
                    {album.photoCount}{" "}
                    {album.photoCount === 1 ? "photo" : "photos"}
                  </p>
                  {album.description && (
                    <p className="mt-2 line-clamp-2 text-sm text-ink-soft">
                      {album.description}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
