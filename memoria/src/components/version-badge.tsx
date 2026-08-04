/**
 * Fixed build/version badge in the bottom-right corner of every page. In dev it
 * reads "Development"; in a production build it shows the package version and
 * the short commit hash baked in at build time (see next.config.ts).
 */
export function VersionBadge() {
  const isDev = process.env.NODE_ENV === "development";
  const label = isDev
    ? "Development"
    : `v${process.env.APP_VERSION} · ${process.env.APP_COMMIT}`;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none fixed right-3 bottom-3 z-50 rounded-sm border border-line bg-paper/80 px-2 py-1 font-mono text-[10px] tracking-wide text-ink-faint backdrop-blur select-none"
    >
      {label}
    </span>
  );
}
