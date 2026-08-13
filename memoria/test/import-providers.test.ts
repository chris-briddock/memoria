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

    const files = await list(cloudProvider("gdrive")!, "user-1");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
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
    await expect(list(cloudProvider("gdrive")!, "u")).resolves.toEqual([]);
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
    const files = await list(cloudProvider("gdrive")!, "u");
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

    const files = await list(cloudProvider("onedrive")!, "user-1");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      id: "item1",
      name: "photo.png",
      mimeType: "image/png",
      size: 500,
    });
  });

  it("throws when the listing call fails", async () => {
    const { listDriveFiles: list } = await withToken();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(list(cloudProvider("gdrive")!, "user-1")).rejects.toThrow(
      /Google Drive list failed \(500\)/,
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
