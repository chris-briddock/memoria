import "server-only";
import { getValidAccessToken } from "./token";
import type { CloudProviderDef } from "@/lib/import-providers";

/**
 * Google Photos removed Library API read access in 2025; programmatic import
 * now goes through the Picker API: we create a session, the user picks items
 * in Google's UI (pickerUri), then we poll the session and download the
 * selected media items.
 */

const PICKER_BASE = "https://photospicker.googleapis.com/v1";

type FetchFn = typeof fetch;

export type PickedItem = {
  id: string;
  name: string;
  mimeType: string;
  /** Short-lived URL; download promptly. */
  baseUrl: string;
};

export async function createPickerSession(
  provider: CloudProviderDef,
  userId: string,
  fetchFn: FetchFn = fetch,
): Promise<{ sessionId: string; pickerUri: string }> {
  const accessToken = await getValidAccessToken(provider, userId);
  const res = await fetchFn(`${PICKER_BASE}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Could not create Google Photos picker session (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string; pickerUri?: string };
  if (!json.id || !json.pickerUri) {
    throw new Error("Google Photos picker session response missing id or pickerUri");
  }
  return { sessionId: json.id, pickerUri: json.pickerUri };
}

/**
 * Returns null while the user is still picking; the item list once
 * `mediaItemsSet` is true. Caller should poll this a few times before giving up.
 */
export async function pollPickerSession(
  provider: CloudProviderDef,
  userId: string,
  sessionId: string,
  fetchFn: FetchFn = fetch,
): Promise<PickedItem[] | null> {
  const accessToken = await getValidAccessToken(provider, userId);
  const res = await fetchFn(`${PICKER_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Could not poll picker session (${res.status})`);
  const session = (await res.json()) as { mediaItemsSet?: boolean };
  if (!session.mediaItemsSet) return null;

  const items: PickedItem[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${PICKER_BASE}/mediaItems`);
    url.searchParams.set("sessionId", sessionId);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const listRes = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!listRes.ok) throw new Error(`Could not list picked media items (${listRes.status})`);
    const data = (await listRes.json()) as {
      mediaItems?: Array<{
        id: string;
        mimeType?: string;
        mediaFile?: { baseUrl?: string; filename?: string; mimeType?: string };
      }>;
      nextPageToken?: string;
    };
    for (const item of data.mediaItems ?? []) {
      const baseUrl = item.mediaFile?.baseUrl;
      if (!baseUrl) continue;
      items.push({
        id: item.id,
        name: item.mediaFile?.filename ?? item.id,
        mimeType: item.mimeType ?? item.mediaFile?.mimeType ?? "image/jpeg",
        baseUrl,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return items;
}

export async function downloadPickedItem(
  item: PickedItem,
  fetchFn: FetchFn = fetch,
): Promise<Buffer> {
  // Picker baseUrls require =d for the full-resolution download.
  const res = await fetchFn(`${item.baseUrl}=d`);
  if (!res.ok) throw new Error(`Could not download picked item (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
