import { Uploader } from "@/components/uploader";
import { PhotoGrid, groupByMonth } from "@/components/photo-grid";
import { getVaultStats, listPhotos } from "@/lib/queries";
import { formatBytes } from "@/lib/format";

export default async function GalleryPage() {
  const [photos, stats] = await Promise.all([listPhotos(), getVaultStats()]);
  const months = groupByMonth(photos);

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            All photos
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {stats.photos} {stats.photos === 1 ? "photo" : "photos"} ·{" "}
            {formatBytes(stats.bytes)} · {stats.albums}{" "}
            {stats.albums === 1 ? "album" : "albums"} · {stats.members}{" "}
            {stats.members === 1 ? "member" : "members"}
          </p>
        </div>
      </header>

      <Uploader />

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
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">
            The vault is empty
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
            Add the first photos above. Memoria reads the capture date from each
            file, so older scans and camera exports sort into place on their own.
          </p>
        </div>
      ) : (
        <div className="space-y-12">
          {months.map((month) => (
            <section key={month.key} className="space-y-4">
              <h2 className="border-b border-line pb-2 text-xs font-medium tracking-[0.12em] text-ink-faint uppercase">
                {month.label}
              </h2>
              <PhotoGrid photos={month.photos} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
