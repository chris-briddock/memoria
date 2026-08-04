import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPhoto, listAlbums, albumsForPhoto } from "@/lib/queries";
import { verifySession } from "@/lib/dal";
import { PhotoActions } from "./photo-actions";
import { AlbumPicker } from "./album-picker";
import { formatBytes } from "@/lib/format";

export const metadata: Metadata = { title: "Photo" };

export default async function PhotoPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;
  const [user, row] = await Promise.all([verifySession(), getPhoto(id)]);
  if (!row) notFound();

  const { photo, uploaderName, uploaderEmail } = row;
  const [allAlbums, memberOf] = await Promise.all([
    listAlbums(),
    albumsForPhoto(photo.id),
  ]);

  const canDelete = photo.uploadedBy === user.id || user.role === "admin";

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="text-sm text-ink-soft transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        ← Back to photos
      </Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Dark gallery stage in both schemes — photographs read best against
            near-black, like a museum print room. */}
        <div className="overflow-hidden rounded-lg bg-[#0b0b0c] p-4 sm:p-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/photos/${photo.id}/orig`}
            alt={photo.caption ?? photo.originalFilename}
            className="mx-auto max-h-[80vh] w-auto object-contain"
          />
        </div>

        <aside className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight break-words">
              {photo.caption || photo.originalFilename}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              Uploaded by {uploaderName ?? uploaderEmail}
            </p>
          </div>

          <PhotoActions
            photoId={photo.id}
            favorite={photo.favorite}
            caption={photo.caption}
            canDelete={canDelete}
          />

          <AlbumPicker
            photoId={photo.id}
            albums={allAlbums.map((a) => ({ id: a.id, name: a.name }))}
            memberOf={memberOf.map((a) => a.id)}
          />

          <dl className="border-t border-line">
            <Detail
              label="Taken"
              value={
                photo.takenAt
                  ? photo.takenAt.toLocaleString("en-GB", {
                      dateStyle: "full",
                      timeStyle: "short",
                    })
                  : "Unknown"
              }
            />
            <Detail label="File" value={photo.originalFilename} />
            <Detail
              label="Dimensions"
              value={
                photo.width && photo.height
                  ? `${photo.width} × ${photo.height}`
                  : "Unknown"
              }
            />
            <Detail label="Size" value={formatBytes(photo.byteSize)} />
            <Detail label="Type" value={photo.mimeType} />
          </dl>

          <a
            href={`/api/photos/${photo.id}/orig`}
            download={photo.originalFilename}
            className="btn-primary w-full"
          >
            Download original
          </a>
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
      <dt className="shrink-0 text-[11px] font-medium tracking-wider text-ink-faint uppercase">
        {label}
      </dt>
      <dd className="text-right text-sm break-words text-ink">{value}</dd>
    </div>
  );
}
