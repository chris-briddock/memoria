"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";

type Summary = { created: number; duplicates: number; failed: number };
type Failure = { filename: string; reason: string };

export function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [isPending, startTransition] = useTransition();

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      setBusy(true);
      setSummary(null);
      setFailures([]);

      try {
        const body = new FormData();
        for (const file of list) body.append("files", file);

        const res = await fetch("/api/upload", { method: "POST", body });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: null }));
          throw new Error(error ?? `Upload failed (${res.status})`);
        }

        const data = await res.json();
        setSummary({
          created: data.created,
          duplicates: data.duplicates,
          failed: data.failed,
        });
        setFailures(
          (data.results as Array<Failure & { status: string }>).filter(
            (r) => r.status === "failed",
          ),
        );

        // Pull the new rows into the already-rendered server component.
        startTransition(() => router.refresh());
      } catch (err) {
        setFailures([
          {
            filename: "Upload",
            reason: err instanceof Error ? err.message : "Something went wrong",
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const working = busy || isPending;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          await upload(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition ${
          dragging
            ? "border-accent bg-accent-soft"
            : "border-line bg-paper-raised"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-7 w-7 ${dragging ? "text-accent" : "text-ink-faint"}`}
          aria-hidden
        >
          <path d="M12 16V4m0 0l-4 4m4-4l4 4" />
          <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
        </svg>
        <p className="text-sm font-medium text-ink">
          {working ? "Uploading and building thumbnails…" : "Drop photos here"}
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn-primary"
          disabled={working}
        >
          Choose photos
        </button>
        <p className="text-xs text-ink-faint">
          JPEG, PNG, WebP, AVIF, GIF, TIFF or HEIC · up to 50 MB each
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            if (e.target.files) await upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {summary && (
        <p className="text-sm text-ink-soft" role="status">
          <span className="font-medium text-ink">Added {summary.created}</span>
          {summary.duplicates > 0 && ` · skipped ${summary.duplicates} already in the vault`}
          {summary.failed > 0 && (
            <span className="text-accent"> · {summary.failed} failed</span>
          )}
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
