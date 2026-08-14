import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_PROVIDERS, cloudProvider, importSurface } from "@/lib/import-providers";

const ENV_KEYS = [
  "IMPORT_GOOGLE_CLIENT_ID",
  "IMPORT_GOOGLE_CLIENT_SECRET",
  "IMPORT_MICROSOFT_CLIENT_ID",
  "IMPORT_MICROSOFT_CLIENT_SECRET",
];

function setImportEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  setImportEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));
  vi.unstubAllGlobals();
});

describe("import provider registry", () => {
  it("exposes gdrive, onedrive and a google-photos surface over gdrive", () => {
    expect(CLOUD_PROVIDERS.map((p) => p.id)).toEqual(["gdrive", "onedrive"]);
    expect(importSurface("google-photos")?.provider.id).toBe("gdrive");
    expect(importSurface("google-photos")?.kind).toBe("picker");
    expect(importSurface("onedrive")?.kind).toBe("drive");
    expect(importSurface("nope")).toBeUndefined();
  });

  it("does not leak sign-in providers into the import registry", () => {
    // Sign-in Google ("google") is a different account row than storage
    // Google ("gdrive"); the two must never collide.
    expect(cloudProvider("google")).toBeUndefined();
  });

  it("requests User.Read for OneDrive so Graph /me resolves the account id", () => {
    // Regression: without User.Read the connect flow 401s after the token
    // exchange, when fetchExternalAccountId calls graph.microsoft.com/me.
    const scope = cloudProvider("onedrive")?.scope ?? "";
    for (const required of ["Files.Read", "offline_access", "User.Read"]) {
      expect(scope.split(" ")).toContain(required);
    }
  });
});

describe("listDriveFiles", () => {
  async function withToken() {
    vi.resetModules();
    vi.doMock("@/lib/drive/token", () => ({
      getValidAccessToken: vi.fn().mockResolvedValue("access-token"),
    }));
    return import("@/lib/drive/providers");
  }

  it("maps Google Drive files and embeds the download URL", async () => {
    const { listDriveFiles: list } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [
            {
              id: "abc",
              name: "holiday.jpg",
              mimeType: "image/jpeg",
              size: "12345",
              thumbnailLink: "https://thumb",
              createdTime: "2024-06-01T00:00:00Z",
            },
            { id: "nosize", name: "skip.png", mimeType: "image/png" },
          ],
        }),
        { status: 200 },
      ),
    );

    const page = await list(cloudProvider("gdrive")!, "user-1");
    expect(page.files).toHaveLength(1);
    expect(page.nextPageToken).toBeNull();
    expect(page.files[0]).toMatchObject({
      id: "abc",
      name: "holiday.jpg",
      mimeType: "image/jpeg",
      size: 12345,
      thumbnailUrl: "https://thumb",
      downloadUrl: "https://www.googleapis.com/drive/v3/files/abc?alt=media",
    });
  });

  it("returns the default list without contact when files is empty", async () => {
    const { listDriveFiles: list } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    await expect(list(cloudProvider("gdrive")!, "u")).resolves.toEqual({
      files: [],
      nextPageToken: null,
    });
  });

  it("keeps working when optional Drive fields are absent", async () => {
    const { listDriveFiles: list } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [{ id: "a", name: "n.jpg", mimeType: "image/jpeg", size: "10" }],
        }),
        { status: 200 },
      ),
    );
    const { files } = await list(cloudProvider("gdrive")!, "u");
    expect(files[0].thumbnailUrl).toBeNull();
    expect(files[0].createdTime).toBeNull();
  });

  it("filters OneDrive items to accepted mime types", async () => {
    const { listDriveFiles: list } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          value: [
            {
              id: "item1",
              name: "photo.png",
              size: 500,
              createdDateTime: "2024-01-01T00:00:00Z",
              file: { mimeType: "image/png" },
            },
            {
              id: "item2",
              name: "doc.docx",
              size: 100,
              file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
            },
            { id: "folder", name: "folder", size: 0 },
          ],
        }),
        { status: 200 },
      ),
    );

    const page = await list(cloudProvider("onedrive")!, "user-1");
    expect(page.files).toHaveLength(1);
    expect(page.files[0]).toMatchObject({
      id: "item1",
      name: "photo.png",
      mimeType: "image/png",
      size: 500,
    });
  });

  it("passes the Google pageToken back to Drive and surfaces nextPageToken", async () => {
    const { listDriveFiles: list } = await withToken();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            files: [{ id: "a", name: "a.jpg", mimeType: "image/jpeg", size: "1" }],
            nextPageToken: "tok-2",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            files: [{ id: "b", name: "b.jpg", mimeType: "image/jpeg", size: "1" }],
          }),
          { status: 200 },
        ),
      );

    const first = await list(cloudProvider("gdrive")!, "u");
    expect(first.nextPageToken).toBe("tok-2");

    const second = await list(cloudProvider("gdrive")!, "u", first.nextPageToken);
    expect(second.files[0].id).toBe("b");

    const secondCallUrl = vi.mocked(fetch).mock.calls[1][0] as URL;
    expect(secondCallUrl.searchParams.get("pageToken")).toBe("tok-2");
  });

  it("follows a folder's @odata.nextLink verbatim while filling the page", async () => {
    const { listDriveFiles: list } = await withToken();
    const nextLink =
      "https://graph.microsoft.com/v1.0/me/drive/items/root/children?$select=id&$skiptoken=abc123";
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [{ id: "p1", name: "p1.jpg", size: 10, file: { mimeType: "image/jpeg" } }],
            "@odata.nextLink": nextLink,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [{ id: "p2", name: "p2.jpg", size: 10, file: { mimeType: "image/jpeg" } }],
          }),
          { status: 200 },
        ),
      );

    // The page isn't full after the first children response, so the walker
    // keeps going and fetches the nextLink in the same call.
    const page = await list(cloudProvider("onedrive")!, "u");
    expect(page.files.map((f) => f.id)).toEqual(["p1", "p2"]);
    expect(page.nextPageToken).toBeNull();

    // The second fetch goes to the exact URL Microsoft handed us — no params
    // re-appended, nothing overwritten.
    const secondCallUrl = String(vi.mocked(fetch).mock.calls[1][0]);
    expect(secondCallUrl).toBe(nextLink);
  });

  it("resumes a partially-consumed children page via the opaque token", async () => {
    const { listDriveFiles: list } = await withToken();
    const fifteen = Array.from({ length: 15 }, (_, i) => ({
      id: `f${i}`,
      name: `f${i}.jpg`,
      size: 10,
      file: { mimeType: "image/jpeg" },
    }));
    const pageJson = () =>
      new Response(JSON.stringify({ value: fifteen }), { status: 200 });
    vi.mocked(fetch).mockResolvedValueOnce(pageJson());

    // First call stops mid-page once the client page is full.
    const first = await list(cloudProvider("onedrive")!, "u");
    expect(first.files.map((f) => f.id)).toEqual(fifteen.slice(0, 10).map((f) => f.id));
    expect(first.nextPageToken).toBeTypeOf("string");

    vi.mocked(fetch).mockResolvedValueOnce(pageJson());
    // Second call re-fetches the same children URL and skips what was offered.
    const second = await list(cloudProvider("onedrive")!, "u", first.nextPageToken);
    expect(second.files.map((f) => f.id)).toEqual(fifteen.slice(10).map((f) => f.id));
    expect(second.nextPageToken).toBeNull();

    const rootChildrenUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(rootChildrenUrl);
  });

  it("ignores a forged page token whose resume URL points off Graph", async () => {
    const { listDriveFiles: list } = await withToken();
    const evil = Buffer.from(
      JSON.stringify({
        stack: [],
        resume: { url: "https://attacker.example.com/steal?x=", offset: 0 },
      }),
      "utf8",
    ).toString("base64url");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          value: [{ id: "safe", name: "safe.jpg", size: 10, file: { mimeType: "image/jpeg" } }],
        }),
        { status: 200 },
      ),
    );

    const page = await list(cloudProvider("onedrive")!, "u", evil);
    expect(page.files[0].id).toBe("safe");
    // Fallback restarted at the drive root, never at the attacker URL.
    const requestUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(requestUrl).toContain("/me/drive/items/root/children");
    expect(requestUrl).not.toContain("attacker.example.com");
  });

  it("ignores a forged page token whose resume URL is not a URL at all", async () => {
    const { listDriveFiles: list } = await withToken();
    const garbage = Buffer.from(
      JSON.stringify({ stack: [], resume: { url: "::not-a-url", offset: 0 } }),
      "utf8",
    ).toString("base64url");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          value: [{ id: "safe", name: "safe.jpg", size: 10, file: { mimeType: "image/jpeg" } }],
        }),
        { status: 200 },
      ),
    );

    await list(cloudProvider("onedrive")!, "u", garbage);
    const requestUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(requestUrl).toContain("/me/drive/items/root/children");
  });

  it("descends into subfolders so nested files are listed too", async () => {
    const { listDriveFiles: list } = await withToken();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              { id: "root-pic", name: "root.jpg", size: 10, file: { mimeType: "image/jpeg" } },
              { id: "fld1", name: "Holidays", folder: { childCount: 1 } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              { id: "nested-pic", name: "nested.jpg", size: 20, file: { mimeType: "image/jpeg" } },
            ],
          }),
          { status: 200 },
        ),
      );

    const page = await list(cloudProvider("onedrive")!, "u");
    expect(page.files.map((f) => f.id)).toEqual(["root-pic", "nested-pic"]);
    expect(page.nextPageToken).toBeNull();

    const folderUrl = String(vi.mocked(fetch).mock.calls[1][0]);
    expect(folderUrl).toContain("/me/drive/items/fld1/children");
    expect(folderUrl).toContain("%24expand=thumbnails");
  });

  it("prefers the medium thumbnail size so grid tiles aren't pixelated", async () => {
    const { listDriveFiles: list } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          value: [
            {
              id: "t1",
              name: "t.jpg",
              size: 10,
              file: { mimeType: "image/jpeg" },
              thumbnails: [
                {
                  small: { url: "https://thumb/small" },
                  medium: { url: "https://thumb/medium" },
                  large: { url: "https://thumb/large" },
                },
              ],
            },
            {
              id: "t2",
              name: "u.jpg",
              size: 10,
              file: { mimeType: "image/jpeg" },
              // Drive sometimes only generates the small rendition.
              thumbnails: [{ small: { url: "https://thumb/only-small" } }],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { files } = await list(cloudProvider("onedrive")!, "u");
    expect(files[0].thumbnailUrl).toBe("https://thumb/medium");
    expect(files[1].thumbnailUrl).toBe("https://thumb/only-small");

    const requestUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    // Children listing, not delta: delta silently drops thumbnails on
    // consumer OneDrive and ignores $top. Children + $expand gives us both,
    // and the walker starts at the canonical root item id.
    expect(requestUrl).toContain("/me/drive/items/root/children");
    expect(requestUrl).toContain("%24expand=thumbnails");
    expect(requestUrl).toContain("%24top=");
  });

  it("throws when the listing call fails", async () => {
    const { listDriveFiles: list } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(list(cloudProvider("gdrive")!, "user-1")).rejects.toThrow(
      /Google Drive list failed \(500\)/,
    );
  });
});

describe("fetchDriveThumbnail", () => {
  async function withToken() {
    vi.resetModules();
    vi.doMock("@/lib/drive/token", () => ({
      getValidAccessToken: vi.fn().mockResolvedValue("access-token"),
    }));
    return import("@/lib/drive/providers");
  }

  it("resolves Google's thumbnailLink and fetches it with the OAuth token", async () => {
    const { fetchDriveThumbnail: thumb } = await withToken();
    const pixels = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const link = "https://drive.google.com/thumbnail?sz=w220&id=rabbit-1";
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ thumbnailLink: link }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(pixels, { status: 200, headers: { "Content-Type": "image/jpeg" } }),
      );

    const out = await thumb(cloudProvider("gdrive")!, "user-1", "rabbit-1");
    expect(out.contentType).toBe("image/jpeg");
    expect(Buffer.from(out.body).equals(Buffer.from(pixels))).toBe(true);

    // Meta call targets the file's fields.
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
      "drive/v3/files/rabbit-1?fields=thumbnailLink",
    );
    // Bytes call is the exact thumbnailLink, with the bearer token attached —
    // which is precisely what a hot-linked <img> cannot do.
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(link);
    const authHeader = (vi.mocked(fetch).mock.calls[1][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(authHeader.Authorization).toBe("Bearer access-token");
  });

  it("requests the medium rendition content for OneDrive", async () => {
    const { fetchDriveThumbnail: thumb } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } }),
    );

    const out = await thumb(cloudProvider("onedrive")!, "user-1", "item-7");
    expect(out.contentType).toBe("image/jpeg");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
      "/me/drive/items/item-7/thumbnails/0/medium/content",
    );
  });

  it("reports Google files that have no generated thumbnail", async () => {
    const { fetchDriveThumbnail: thumb } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    await expect(thumb(cloudProvider("gdrive")!, "user-1", "no-thumb")).rejects.toThrow(
      /No thumbnail available/,
    );
  });
});

describe("downloadDriveFile", () => {
  async function withToken() {
    vi.resetModules();
    vi.doMock("@/lib/drive/token", () => ({
      getValidAccessToken: vi.fn().mockResolvedValue("access-token"),
    }));
    return import("@/lib/drive/providers");
  }

  it("rejects obviously-oversized downloads before buffering", async () => {
    const { downloadDriveFile: download } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Content-Length": "999999999", "Content-Type": "image/jpeg" },
      }),
    );
    await expect(
      download(cloudProvider("gdrive")!, "user-1", "big-file"),
    ).rejects.toThrow(/too large/i);
  });

  it("rejects an unknown provider id on list", async () => {
    const { listDriveFiles: list } = await withToken();
    const bogus = { id: "bogus" } as never;
    await expect(list(bogus, "user-1")).rejects.toThrow(/Unknown import provider/);
  });

  it("downloads the bytes and resolves the real filename from metadata", async () => {
    const { downloadDriveFile: download } = await withToken();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(png, { status: 200, headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "real-name.png", mimeType: "image/png" }), { status: 200 }),
      );

    const result = await download(cloudProvider("gdrive")!, "user-1", "file-id");
    expect(result.name).toBe("real-name.png");
    expect(result.mimeType).toBe("image/png");
    expect(result.body.equals(png)).toBe(true);
  });

  it("falls back to the file id when the metadata lookup fails", async () => {
    const { downloadDriveFile: download } = await withToken();
    const bytes = Buffer.from("data");
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(bytes, { status: 200, headers: { "Content-Type": "image/jpeg" } }))
      .mockRejectedValueOnce(new Error("network"));

    const result = await download(cloudProvider("onedrive")!, "user-1", "file-id");
    expect(result.name).toBe("file-id");
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("keeps the transfer content type when metadata returns no mimeType", async () => {
    const { downloadDriveFile: download } = await withToken();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(Buffer.from("x"), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "n.png" }), { status: 200 }));

    const result = await download(cloudProvider("gdrive")!, "user-1", "fid");
    expect(result.mimeType).toBe("image/png");
  });

  it("falls back to octet-stream when neither transfer nor metadata carry a type", async () => {
    const { downloadDriveFile: download } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(Buffer.from("x"), { status: 200 }));
    const result = await download(cloudProvider("gdrive")!, "user-1", "fid");
    expect(result.mimeType).toBe("application/octet-stream");
    expect(result.name).toBe("fid");
  });
});
