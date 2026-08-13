"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type Surface = {
  id: string;
  label: string;
  kind: "drive" | "picker";
  configured: boolean;
  connected: boolean;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  thumbnailUrl: string | null;
  size: number;
  createdTime: string | null;
};

type Summary = { created: number; duplicates: number; failed: number };
type Failure = { filename: string; reason: string };

type PickedItem = { id: string; name: string; mimeType: string; baseUrl: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

const POLL_INTERVAL_MS = 3000;
const POLL_LIMIT = 100; // ~5 minutes of polling

export function ImportClient({ surfaces }: Readonly<{ surfaces: Surface[] }>) {
  const router = useRouter();
  const connected = surfaces.filter((s) => s.configured && s.connected);
  const [activeId, setActiveId] = useState<string | null>(connected[0]?.id ?? null);
  const active = connected.find((s) => s.id === activeId) ?? null;

  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);

  // Picker state
  const [pickerWaiting, setPickerWaiting] = useState(false);
  const pollCount = useRef(0);

  async function loadFiles(surfaceId: string) {
    setFiles(null);
    setFilesError(null);
    setSelected(new Set());
    setSummary(null);
    setFailures([]);
    const res = await fetch(`/api/import/${surfaceId}/files`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setFilesError((body?.error as string) ?? "Could not list files.");
      return;
    }
    setFiles((body?.files as DriveFile[]) ?? []);
  }

  // Kick off the first load once mounted. Deferring to a microtask keeps the
  // setState calls out of the synchronous effect body (react-hooks/set-state-in-effect).
  const initialLoad = useRef(false);
  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    if (active && active.kind === "drive") {
      const t = setTimeout(() => void loadFiles(active.id), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
  }, []);

  function selectTab(id: string) {
    setActiveId(id);
    const surface = connected.find((s) => s.id === id);
    if (surface?.kind === "drive") void loadFiles(id);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function importSelected() {
    if (!active || selected.size === 0) return;
    setBusy(true);
    setSummary(null);
    setFailures([]);
    try {
      const res = await fetch(`/api/import/${active.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: Array.from(selected) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body?.error as string) ?? `Import failed (${res.status})`);
      setSummary({ created: body.created, duplicates: body.duplicates, failed: body.failed });
      setFailures(
        ((body?.results as Array<Failure & { status: string }>) ?? []).filter(
          (r) => r.status === "failed",
        ),
      );
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setFailures([
        { filename: "Import", reason: err instanceof Error ? err.message : "Something went wrong" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function startPicker() {
    setPickerWaiting(true);
    setSummary(null);
    setFailures([]);
    try {
      const res = await fetch("/api/google-photos/files", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body?.error as string) ?? "Could not start picker");
      const { pickerUri, sessionId } = body as { pickerUri: string; sessionId: string };
      window.open(pickerUri, "_blank", "noopener");

      pollCount.current = 0;
      const timer = setInterval(async () => {
        pollCount.current++;
        if (pollCount.current > POLL_LIMIT) {
          clearInterval(timer);
          setPickerWaiting(false);
          setFailures([{ filename: "Picker", reason: "Timed out waiting for your selection." }]);
          return;
        }
        const poll = await fetch(
          `/api/google-photos/files?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (!poll.ok) return; // transient; try again next tick
        const pollBody = await poll.json().catch(() => null);
        if (!pollBody?.done) return;
        clearInterval(timer);
        setPickerWaiting(false);
        const items = (pollBody.items as PickedItem[]) ?? [];
        if (items.length === 0) {
          setFailures([{ filename: "Picker", reason: "No items were selected." }]);
          return;
        }
        setBusy(true);
        try {
          const importRes = await fetch("/api/google-photos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items }),
          });
          const importBody = await importRes.json().catch(() => null);
          if (!importRes.ok) {
            throw new Error((importBody?.error as string) ?? "Import failed");
          }
          setSummary({
            created: importBody.created,
            duplicates: importBody.duplicates,
            failed: importBody.failed,
          });
          setFailures(
            ((importBody?.results as Array<Failure & { status: string }>) ?? []).filter(
              (r) => r.status === "failed",
            ),
          );
          router.refresh();
        } catch (err) {
          setFailures([
            {
              filename: "Import",
              reason: err instanceof Error ? err.message : "Something went wrong",
            },
          ]);
        } finally {
          setBusy(false);
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setPickerWaiting(false);
      setFailures([
        { filename: "Picker", reason: err instanceof Error ? err.message : "Something went wrong" },
      ]);
    }
  }

  if (connected.length === 0) {
    return (
      <div className="card px-6 py-12 text-center">
        <p className="text-sm text-ink-soft">
          No cloud storage is connected yet. Connect Google Drive or OneDrive
          from{" "}
          <a href="/settings" className="text-accent underline underline-offset-2">
            Settings
          </a>{" "}
          first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Import source">
        {connected.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={activeId === s.id}
            onClick={() => selectTab(s.id)}
            className={activeId === s.id ? "btn-primary" : "btn-ghost"}
          >
            {s.label}
          </button>
        ))}
      </div>

      {active?.kind === "picker" && (
        <div className="card space-y-3 px-5 py-6">
          <p className="text-sm text-ink-soft">
            Pick photos in Google&rsquo;s picker UI &mdash; it opens in a new tab. Once
            you confirm your selection, Memoria imports everything you picked.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={startPicker}
            disabled={pickerWaiting || busy}
          >
            {pickerWaiting
              ? "Waiting for your selection…"
              : busy
                ? "Importing…"
                : "Pick photos from Google Photos"}
          </button>
          {pickerWaiting && (
            <p className="text-xs text-ink-faint">
              Finish picking in the Google tab; this page updates automatically.
            </p>
          )}
        </div>
      )}

      {active?.kind === "drive" && (
        <div className="space-y-4">
          {filesError && (
            <p role="alert" className="card px-5 py-4 text-sm text-accent">
              {filesError}
            </p>
          )}
          {files === null && !filesError && (
            <p className="text-sm text-ink-soft">Loading your files…</p>
          )}
          {files !== null && files.length === 0 && (
            <p className="card px-5 py-4 text-sm text-ink-soft">
              No supported photos found in {active.label}.
            </p>
          )}
          {files !== null && files.length > 0 && (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {files.map((f) => {
                  const isSelected = selected.has(f.id);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => toggle(f.id)}
                        aria-pressed={isSelected}
                        className={`block w-full overflow-hidden rounded-lg border-2 text-left transition ${
                          isSelected ? "border-accent" : "border-line hover:border-ink-faint"
                        }`}
                      >
                        {f.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- remote provider thumbnails
                          <img
                            src={f.thumbnailUrl}
                            alt=""
                            className="aspect-square w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center bg-paper-raised text-ink-faint">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-8 w-8" aria-hidden>
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <circle cx="9" cy="9" r="2" />
                              <path d="M21 15l-5-5L5 21" />
                            </svg>
                          </div>
                        )}
                        <span className="block truncate px-2 py-1.5 text-xs text-ink-soft">
                          {f.name}
                        </span>
                        <span className="block px-2 pb-1.5 text-[10px] text-ink-faint">
                          {formatBytes(f.size)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={importSelected}
                  disabled={selected.size === 0 || busy}
                >
                  {busy
                    ? "Importing…"
                    : `Import ${selected.size === 0 ? "" : `${selected.size} `}selected`}
                </button>
                {selected.size > 0 && (
                  <button type="button" className="btn-ghost text-sm" onClick={() => setSelected(new Set())} disabled={busy}>
                    Clear selection
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {summary && (
        <p className="text-sm text-ink-soft" role="status">
          <span className="font-medium text-ink">Added {summary.created}</span>
          {summary.duplicates > 0 && ` · skipped ${summary.duplicates} already in the vault`}
          {summary.failed > 0 && <span className="text-accent"> · {summary.failed} failed</span>}
        </p>
      )}

      {failures.length > 0 && (
        <ul className="space-y-1 text-sm text-accent">
          {failures.map((f, i) => (
            <li key={`${f.filename}-${i}`}>
              <span className="font-medium">{f.filename}</span>: {f.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
