import type { Metadata } from "next";
import { apiGetRequired } from "@/lib/api-client";
import { ImportClient, type Surface } from "./import-client";

export const metadata: Metadata = { title: "Import" };

type ImportStatus = {
  providers: { id: string; label: string; configured: boolean; connected: boolean }[];
  surfaces: Surface[];
};

export default async function ImportPage() {
  const status = await apiGetRequired<ImportStatus>("/api/import");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Import from the cloud
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Pull photos in from Google Drive, Google Photos, or Microsoft
          OneDrive. Imports run through the same pipeline as direct uploads —
          duplicates are skipped automatically.
        </p>
      </header>

      <ImportClient surfaces={status.surfaces} />
    </div>
  );
}
