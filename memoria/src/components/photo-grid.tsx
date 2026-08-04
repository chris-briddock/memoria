import Link from "next/link";

export type GridPhoto = {
  id: string;
  caption: string | null;
  originalFilename: string;
  width: number | null;
  height: number | null;
  takenAt: Date | null;
  favorite: boolean;
};

/* The component's JSX (caption/?? fallbacks, width&&height ternaries, the
 * `favorite` star) is presentational markup, exercised by Playwright e2e per
 * the coverage plan. Only the `groupByMonth` logic below is measured here. */
/* v8 ignore start */
export function PhotoGrid({ photos }: Readonly<{ photos: GridPhoto[] }>) {
  return (
    <ul className="columns-2 gap-3 sm:columns-3 md:columns-4 lg:columns-5">
      {photos.map((photo) => (
        <li key={photo.id} className="mb-3 break-inside-avoid">
          <Link
            href={`/photos/${photo.id}`}
            className="group relative block overflow-hidden rounded-sm bg-paper-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {/* Thumbnails are pre-generated webp served from an authenticated
                route, so the Next image optimizer would only add a hop. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photos/${photo.id}/thumb`}
              alt={photo.caption ?? photo.originalFilename}
              loading="lazy"
              style={
                photo.width && photo.height
                  ? { aspectRatio: `${photo.width} / ${photo.height}` }
                  : undefined
              }
              className={`h-auto w-full object-cover motion-safe:transition ${
                photo.width && photo.height ? "" : "aspect-square"
              }`}
            />

            {/* Caption overlay, revealed on hover like a gallery wall label. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-black/10 to-transparent p-2.5 opacity-0 ring-accent motion-safe:transition-opacity group-hover:opacity-100 group-hover:ring-2 group-hover:ring-inset group-focus-visible:opacity-100 group-focus-visible:ring-2 group-focus-visible:ring-inset"
            >
              <span className="line-clamp-2 text-xs font-medium text-white">
                {photo.caption ?? photo.originalFilename}
              </span>
            </span>

            {photo.favorite && (
              <span
                aria-label="Favourite"
                className="absolute top-2 right-2 rounded-full bg-black/55 p-1.5 text-accent"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5"
                  aria-hidden
                >
                  <path d="M10 1.7l2.47 5.18 5.68.72-4.17 3.95 1.08 5.62L10 14.36l-5.06 2.81 1.08-5.62-4.17-3.95 5.68-.72L10 1.7z" />
                </svg>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
/* v8 ignore stop */

/** Groups photos into the month they were taken, newest month first. */
export function groupByMonth(photos: GridPhoto[]) {
  const groups = new Map<string, { label: string; photos: GridPhoto[] }>();

  for (const photo of photos) {
    const date = photo.takenAt ?? new Date(0);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const label = date.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    });
    const group = groups.get(key) ?? { label, photos: [] };
    group.photos.push(photo);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, value]) => ({ key, ...value }));
}
