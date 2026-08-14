import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { apiGet, apiGetRequired } from "@/lib/api-client";
import type { SessionUser } from "@/lib/types";
import type { GridPhoto } from "@/components/photo-grid";
import { PhotoGrid } from "@/components/photo-grid";
import { DeleteAlbumButton } from "./delete-album-button";
import { AlbumPhotoPicker } from "./album-photo-picker";

type AlbumDetail = {
  album: {
    id: string;
    name: string;
    description: string | null;
    coverPhotoId: string | null;
    createdBy: string;
    createdAt: string;
  };
  photos: {
    id: string;
    caption: string | null;
    originalFilename: string;
    width: number | null;
    height: number | null;
    takenAt: string | Date | null;
    favorite: boolean;
  }[];
};

export async function generateMetadata({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>): Promise<Metadata> {
  const { id } = await params;
  const result = await apiGet<AlbumDetail | null>(`/api/albums/${id}`);
  if (!result) return { title: "Album" };
  return { title: result.album.name };
}

export default async function AlbumPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;
  const [user, result] = await Promise.all([
    apiGetRequired<SessionUser>("/api/me"),
    apiGet<AlbumDetail | null>(`/api/albums/${id}`),
  ]);
  if (!result) notFound();

  const { album, photos } = result;
  const allPhotos = await apiGetRequired<GridPhoto[]>("/api/photos");
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

      <AlbumPhotoPicker
        albumId={album.id}
        photos={allPhotos.map((p) => ({
          id: p.id,
          caption: p.caption,
          originalFilename: p.originalFilename,
          width: p.width,
          height: p.height,
        }))}
        memberOf={photos.map((p) => p.id)}
      />

      {photos.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Nothing here yet
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Use the <span className="italic">Add photos</span> button above to
            file existing photos here, or tick{" "}
            <span className="italic">{album.name}</span> under Albums on any
            photo&rsquo;s page.
          </p>
        </div>
      ) : (
        <PhotoGrid photos={photos} />
      )}
    </div>
  );
}
