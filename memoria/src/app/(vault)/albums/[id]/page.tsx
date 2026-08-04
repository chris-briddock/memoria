import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAlbum } from "@/lib/queries";
import { verifySession } from "@/lib/dal";
import { PhotoGrid } from "@/components/photo-grid";
import { DeleteAlbumButton } from "./delete-album-button";

export async function generateMetadata({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>): Promise<Metadata> {
  const { id } = await params;
  const result = await getAlbum(id);
  return { title: result?.album.name ?? "Album" };
}

export default async function AlbumPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;
  const [user, result] = await Promise.all([verifySession(), getAlbum(id)]);
  if (!result) notFound();

  const { album, photos } = result;
  const canDelete = album.createdBy === user.id || user.role === "admin";

  return (
    <div className="space-y-10">
      <Link
        href="/albums"
        className="text-sm text-ink-soft transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        ← All albums
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {album.name}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {photos.length} {photos.length === 1 ? "photo" : "photos"}
            {album.description && ` · ${album.description}`}
          </p>
        </div>
        {canDelete && <DeleteAlbumButton albumId={album.id} />}
      </header>

      {photos.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Nothing here yet
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Open any photo and tick <span className="italic">{album.name}</span>{" "}
            under Albums to add it.
          </p>
        </div>
      ) : (
        <PhotoGrid photos={photos} />
      )}
    </div>
  );
}
