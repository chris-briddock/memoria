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

/**
 * Resolves to the media files from one provider page, plus an opaque token the
 * caller hands back to fetch the next page. `nextPageToken === null` means the
 * listing is exhausted. The token encodes whatever each provider needs (a
 * Google pageToken / a Microsoft @odata.nextLink URL) and must be treated as
 * an uninterpretable blob by the API route and the client.
 */
export type DrivePage = {
  files: DriveFile[];
  nextPageToken: string | null;
};

/**
 * Import page size: every provider page returns at most this many files.
 * Google honors it via pageSize; the OneDrive recursive walker slices its
 * own buffer to the same bound so the client always grows by ~this amount
 * per Load more.
 */
export const DRIVE_PAGE_SIZE = 10;

/**
 * Cap on the opaque `nextPageToken` we emit, matching the inbound cap the
 * /api/import/[provider]/files route enforces (tokens longer than this are
 * rejected as invalid). Deep OneDrive trees grow the resume token roughly one
 * folder id per subfolder; once it crosses this limit it could never be
 * handed back, so we stop paging instead of emitting an unusable token.
 */
export const MAX_PAGE_TOKEN_LEN = 4096;

type FetchFn = typeof fetch;

async function googleList(
  accessToken: string,
  fetchFn: FetchFn,
  pageToken: string | null,
): Promise<DrivePage> {
  // fields=* without spaces so Drive returns the small subset we actually use.
  const fields = "files(id,name,mimeType,size,thumbnailLink,createdTime),nextPageToken";
  const q = ACCEPTED_MIME_TYPES.map((m) => `mimeType='${m}'`).join(" or ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `(${q}) and trashed=false`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("pageSize", String(DRIVE_PAGE_SIZE));
  url.searchParams.set("orderBy", "createdTime desc");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

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
    nextPageToken?: string;
  };

  return {
    files: (data.files ?? [])
      .filter((f) => f.size && Number.parseInt(f.size, 10) > 0)
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: Number.parseInt(f.size as string, 10),
        // NOTE: Google's thumbnailLink 403s when hot-linked by a cross-origin
        // <img> (it wants a Google session cookie and can't take this OAuth
        // token in the browser). The API route rewrites this to our same-origin
        // thumbnail proxy, which re-fetches it with the access token attached.
        thumbnailUrl: f.thumbnailLink ?? null,
        createdTime: f.createdTime ?? null,
        downloadUrl: `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`,
      })),
    nextPageToken: data.nextPageToken ?? null,
  };
}

type GraphThumb = { width?: number; height?: number; url?: string };
type GraphChild = {
  id: string;
  name: string;
  size?: number;
  createdDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  thumbnails?: Array<{ small?: GraphThumb; medium?: GraphThumb; large?: GraphThumb }>;
};

/**
 * Best-looking thumbnail the grid can use without pixelation: Graph serves
 * `small` at ~96px, `medium` at ~176px and `large` at several hundred px.
 * Import tiles render well above 100px, so take the medium rendition first,
 * then large, and only fall back to the blurry small as a last resort.
 */
function bestThumbnailUrl(child: GraphChild): string | null {
  const set = child.thumbnails?.[0];
  return set?.medium?.url ?? set?.large?.url ?? set?.small?.url ?? null;
}

type GraphChildrenPage = {
  value?: GraphChild[];
  "@odata.nextLink"?: string;
};

const ONEDRIVE_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
// URL.origin drops the /v1.0 path, so compare against the bare origin.
const ONEDRIVE_GRAPH_ORIGIN = new URL(ONEDRIVE_GRAPH_BASE).origin;
/** /import requests shouldn't stall on very deep/wide trees. */
const ONEDRIVE_MAX_REQUESTS_PER_PAGE = 8;

async function fetchGraphChildren(
  accessToken: string,
  fetchFn: FetchFn,
  url: string,
): Promise<GraphChildrenPage> {
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    // Graph's error body pinpoints the rejected query option; keep it so the
    // server log surfaces the real cause instead of a bare 400.
    const text = await res.text().catch(() => "");
    throw new Error(`OneDrive list failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as GraphChildrenPage;
}

function graphChildrenUrl(folderId: string): string {
  const url = new URL(
    `${ONEDRIVE_GRAPH_BASE}/me/drive/items/${encodeURIComponent(folderId)}/children`,
  );
  url.searchParams.set("$select", "id,name,size,createdDateTime,file,folder");
  // Inline thumbnails on every children call — one round trip per folder,
  // all sizes available on each media item.
  url.searchParams.set("$expand", "thumbnails");
  // Big pages: most folders fit in one call, and we still make progress if
  // we have to follow nextLink.
  url.searchParams.set("$top", "200");
  return url.toString();
}

/**
 * Recursive walk cursor, serialized as base64url JSON between pages.
 *
 * - `stack`: folder ids still to visit, depth-first. The walk pops from the
 *   end, so the last-pushed folder is visited next.
 * - `resume`: the single next children page to fetch — either a folder's
 *   first page (`graphChildrenUrl`) or a verbatim `@odata.nextLink` — plus
 *   `offset`, how many leading entries of that page were already offered to
 *   the client by an earlier request. A resume always re-fetches the page
 *   and skips `offset` entries instead of carrying buffered file/thumbnail
 *   JSON inside the token, which keeps the token tiny.
 *
 * `resume === null` (with an empty stack) means the drive walk is exhausted.
 */
type OneDriveResume = {
  stack: string[];
  resume: { url: string; offset: number } | null;
};

function initialOneDriveResume(): OneDriveResume {
  return { stack: [], resume: { url: graphChildrenUrl("root"), offset: 0 } };
}

function encodeOneDriveToken(state: OneDriveResume): string | null {
  if (state.resume === null && state.stack.length === 0) return null;
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

function decodeOneDriveToken(token: string): OneDriveResume | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      stack?: unknown;
      resume?: unknown;
    };
    if (!Array.isArray(parsed?.stack)) return null;
    const resume = parsed.resume as { url?: unknown; offset?: unknown } | null | undefined;
    if (
      !(
        resume === null ||
        (resume &&
          typeof resume.url === "string" &&
          typeof resume.offset === "number" &&
          new URL(resume.url).origin === ONEDRIVE_GRAPH_ORIGIN)
      )
    ) {
      // Anything we can't prove is a Graph URL would end up fetched with the
      // user's access token attached, so reject the whole token rather than
      // fall back to a partial state the client could mistake for valid.
      return null;
    }
    return {
      stack: (parsed.stack as unknown[]).filter((s): s is string => typeof s === "string"),
      resume:
        resume === null
          ? null
          : { url: (resume as { url: string }).url, offset: Math.max(0, Math.floor((resume as { offset: number }).offset)) },
    };
  } catch {
    return null;
  }
}

async function onedriveList(
  accessToken: string,
  fetchFn: FetchFn,
  pageToken: string | null,
): Promise<DrivePage> {
  // Recursive depth-first walk over the whole drive. `drive/root/delta`
  // drops thumbnails on consumer OneDrive and ignores `$top`, and listing
  // `root/children` alone misses files nested in subfolders — so we page
  // folder-by-folder through children (with inline thumbnails) and carry a
  // resume cursor across client "Load more" requests.
  //
  // Each iteration makes progress in exactly one of three ways: consume an
  // entry from the current page, advance the current folder to its nextLink,
  // or retire the current folder and descend into the next stacked subfolder.
  // The walk can therefore never revisit a folder or spin on an empty one.
  const state =
    (pageToken ? decodeOneDriveToken(pageToken) : null) ?? initialOneDriveResume();
  const stack = [...state.stack];
  let resume = state.resume === null ? null : { ...state.resume };

  const buffer: DriveFile[] = [];
  let requestsUsed = 0;

  // A *page* (what the client sees) is at most DRIVE_PAGE_SIZE files, but
  // one API call to us may walk several folders/pages internally to fill it,
  // bounded by ONEDRIVE_MAX_REQUESTS_PER_PAGE so deep trees can't stall /import.
  while (
    resume !== null &&
    buffer.length < DRIVE_PAGE_SIZE &&
    requestsUsed < ONEDRIVE_MAX_REQUESTS_PER_PAGE
  ) {
    const { url, offset } = resume;
    const page = await fetchGraphChildren(accessToken, fetchFn, url);
    requestsUsed++;
    const children = page.value ?? [];
    const nextUrl = page["@odata.nextLink"] ?? null;

    let i = offset;
    while (i < children.length && buffer.length < DRIVE_PAGE_SIZE) {
      const child = children[i++];
      if (child.folder) {
        // Queue behind everything already stacked; visited once this folder's
        // own listing is exhausted.
        stack.push(child.id);
        continue;
      }
      const mime = child.file?.mimeType;
      if (!mime || !ACCEPTED_MIME_TYPES.includes(mime)) continue;
      buffer.push({
        id: child.id,
        name: child.name,
        mimeType: mime,
        size: child.size ?? 0,
        thumbnailUrl: bestThumbnailUrl(child),
        downloadUrl: `${ONEDRIVE_GRAPH_BASE}/me/drive/items/${child.id}/content`,
        createdTime: child.createdDateTime ?? null,
      });
    }

    if (i < children.length) {
      // The client page filled before this Graph page ran out. Re-fetch the
      // same URL on the next request and skip the entries already offered.
      // children listings are stable enough for import browsing; if the user
      // modifies the folder mid-walk an item may shift by one page boundary.
      resume = { url, offset: i };
    } else if (nextUrl) {
      // Current folder has more children pages; continue it before
      // descending into any subfolders we just discovered.
      resume = { url: nextUrl, offset: 0 };
    } else {
      // Folder listing exhausted — retire it and descend into the next
      // queued subfolder (LIFO), or finish the walk when none remain.
      const nextFolder = stack.pop();
      resume = nextFolder === undefined ? null : { url: graphChildrenUrl(nextFolder), offset: 0 };
    }
  }

  const token = encodeOneDriveToken({ stack, resume });
  // If the token blew past the route's length cap the client could never page
  // further anyway — end the walk here rather than hand back a 400 trap. The
  // files gathered for this page are still returned unchanged.
  return {
    files: buffer,
    nextPageToken: token !== null && token.length > MAX_PAGE_TOKEN_LEN ? null : token,
  };
}

/** ingestPhoto caps uploads at 50 MB; refuse to buffer anything larger. */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export async function listDriveFiles(
  provider: CloudProviderDef,
  userId: string,
  pageToken: string | null = null,
  fetchFn: FetchFn = fetch,
): Promise<DrivePage> {
  const accessToken = await getValidAccessToken(provider, userId);
  if (provider.id === "gdrive") return googleList(accessToken, fetchFn, pageToken);
  if (provider.id === "onedrive") return onedriveList(accessToken, fetchFn, pageToken);
  throw new Error(`Unknown import provider id: ${provider.id}`);
}

/**
 * Server-side thumbnail fetch for the same-origin proxy route. Google's
 * `thumbnailLink` can't be embedded directly by the browser, but it *can* be
 * fetched with the user's OAuth token attached; Microsoft's pre-authenticated
 * `/thumbnails/0/medium` rendition works the same way. Returns the raw
 * upstream body + content type so the route can stream them through.
 */
export async function fetchDriveThumbnail(
  provider: CloudProviderDef,
  userId: string,
  fileId: string,
  fetchFn: FetchFn = fetch,
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const accessToken = await getValidAccessToken(provider, userId);
  const id = encodeURIComponent(fileId);

  let url: string;
  if (provider.id === "gdrive") {
    // Resolve the live thumbnailLink from Drive, then fetch it (with auth).
    const metaRes = await fetchFn(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=thumbnailLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!metaRes.ok) throw new Error(`Thumbnail metadata failed (${metaRes.status})`);
    const meta = (await metaRes.json()) as { thumbnailLink?: string };
    if (!meta.thumbnailLink) throw new Error("No thumbnail available");
    url = meta.thumbnailLink;
  } else if (provider.id === "onedrive") {
    // Graph hands back a pre-authenticated rendition URL in Location after a
    // redirect; fetch doesn't expose redirects portably, so use the content
    // endpoint which serves the rendition bytes directly.
    url = `${ONEDRIVE_GRAPH_BASE}/me/drive/items/${id}/thumbnails/0/medium/content`;
  } else {
    throw new Error(`Unknown import provider id: ${provider.id}`);
  }

  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Thumbnail fetch failed (${res.status})`);
  const body = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  return { body, contentType };
}

export async function downloadDriveFile(
  provider: CloudProviderDef,
  userId: string,
  fileId: string,
  fetchFn: FetchFn = fetch,
): Promise<{ body: Buffer; name: string; mimeType: string }> {
  const accessToken = await getValidAccessToken(provider, userId);
  const id = encodeURIComponent(fileId);

  const url =
    provider.id === "gdrive"
      ? `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
      : `https://graph.microsoft.com/v1.0/me/drive/items/${id}/content`;

  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);

  // Fail fast on obviously-oversized files instead of buffering them first;
  // ingestPhoto would only reject after the full download landed in memory.
  const contentLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Download too large (${contentLength} bytes, limit 52428800)`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const body = Buffer.from(arrayBuffer);

  // Resolve a friendly filename (metadata call) so ingest records a real name.
  let name = fileId;
  let mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  try {
    const metaUrl =
      provider.id === "gdrive"
        ? `https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType`
        : `https://graph.microsoft.com/v1.0/me/drive/items/${id}?$select=name,file`;
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
