import "server-only";
import { getValidAccessToken } from "./token";
import { ACCEPTED_MIME_TYPES } from "@/lib/ingest";
import type { CloudProviderDef } from "@/lib/import-providers";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  /** Direct bytes URL with access-token auth. */
  downloadUrl: string;
  thumbnailUrl: string | null;
  size: number;
  createdTime: string | null;
};

type FetchFn = typeof fetch;

async function googleList(accessToken: string, fetchFn: FetchFn): Promise<DriveFile[]> {
  // fields=* without spaces so Drive returns the small subset we actually use.
  const fields = "files(id,name,mimeType,size,thumbnailLink,createdTime)";
  const q = ACCEPTED_MIME_TYPES.map((m) => `mimeType='${m}'`).join(" or ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `(${q}) and trashed=false`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("orderBy", "createdTime desc");

  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google Drive list failed (${res.status})`);
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      thumbnailLink?: string;
      createdTime?: string;
    }>;
  };

  return (data.files ?? [])
    .filter((f) => f.size && Number.parseInt(f.size, 10) > 0)
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: Number.parseInt(f.size as string, 10),
      thumbnailUrl: f.thumbnailLink ?? null,
      createdTime: f.createdTime ?? null,
      downloadUrl: `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`,
    }));
}

async function onedriveList(accessToken: string, fetchFn: FetchFn): Promise<DriveFile[]> {
  const select = "id,name,size,createdDateTime,file";
  // Microsoft Graph search returns a paged driveItem collection.
  const url = new URL("https://graph.microsoft.com/v1.0/me/drive/root/search(q='')");
  url.searchParams.set("$select", select);
  url.searchParams.set("$top", "200");

  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`OneDrive list failed (${res.status})`);
  const data = (await res.json()) as {
    value?: Array<{
      id: string;
      name: string;
      size: number;
      createdDateTime?: string;
      file?: { mimeType?: string };
      "@microsoft.graph.downloadUrl"?: string;
    }>;
  };

  return (data.value ?? [])
    .filter((f) => f.file?.mimeType && ACCEPTED_MIME_TYPES.includes(f.file.mimeType))
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.file!.mimeType as string,
      size: f.size,
      // Graph's pre-authenticated downloadUrl can be used directly without
      // a bearer token — more robust than /content with Authorization for
      // some tenants. We still prefer /content so auth is uniform.
      downloadUrl: `https://graph.microsoft.com/v1.0/me/drive/items/${f.id}/content`,
      thumbnailUrl: null, // thumbnails require a second Graph call per item
      createdTime: f.createdDateTime ?? null,
    }));
}

export async function listDriveFiles(
  provider: CloudProviderDef,
  userId: string,
  fetchFn: FetchFn = fetch,
): Promise<DriveFile[]> {
  const accessToken = await getValidAccessToken(provider, userId);
  return provider.id === "gdrive"
    ? googleList(accessToken, fetchFn)
    : onedriveList(accessToken, fetchFn);
}

export async function downloadDriveFile(
  provider: CloudProviderDef,
  userId: string,
  fileId: string,
  fetchFn: FetchFn = fetch,
): Promise<{ body: Buffer; name: string; mimeType: string }> {
  const accessToken = await getValidAccessToken(provider, userId);

  const url =
    provider.id === "gdrive"
      ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
      : `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;

  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);

  const arrayBuffer = await res.arrayBuffer();
  const body = Buffer.from(arrayBuffer);

  // Resolve a friendly filename (metadata call) so ingest records a real name.
  let name = fileId;
  let mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  try {
    const metaUrl =
      provider.id === "gdrive"
        ? `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`
        : `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}?$select=name,file`;
    const metaRes = await fetchFn(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as {
        name?: string;
        mimeType?: string;
        file?: { mimeType?: string };
      };
      if (meta.name) name = meta.name;
      mimeType = meta.mimeType ?? meta.file?.mimeType ?? mimeType;
    }
  } catch {
    // Fall back to the transfer's own Content-Type; filename stays fileId.
  }

  return { body, name, mimeType };
}
