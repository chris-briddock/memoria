import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/drive/token", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("picker-token"),
}));

import { cloudProvider } from "@/lib/import-providers";
import {
  createPickerSession,
  downloadPickedItem,
  pollPickerSession,
} from "@/lib/drive/google-photos";

const gdrive = cloudProvider("gdrive")!;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPickerSession", () => {
  it("posts to the Picker API and returns the uri the user must visit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ id: "session-1", pickerUri: "https://photos.google.com/picker/abc" }),
    );

    const session = await createPickerSession(gdrive, "user-1");
    expect(session).toEqual({
      sessionId: "session-1",
      pickerUri: "https://photos.google.com/picker/abc",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://photospicker.googleapis.com/v1/sessions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer picker-token");
    expect(init?.method).toBe("POST");
  });

  it("surfaces API errors with the provider's message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("scope missing", { status: 403 }));
    await expect(createPickerSession(gdrive, "user-1")).rejects.toThrow(/403/);
  });

  it("rejects a malformed success response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));
    await expect(createPickerSession(gdrive, "user-1")).rejects.toThrow(/missing id or pickerUri/);
  });
});

describe("pollPickerSession", () => {
  it("returns null while the user is still picking", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ mediaItemsSet: false }));
    await expect(pollPickerSession(gdrive, "user-1", "session-1")).resolves.toBeNull();
  });

  it("returns the picked items, flattening pagination, once done", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ mediaItemsSet: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          mediaItems: [
            {
              id: "m1",
              mimeType: "image/jpeg",
              mediaFile: { baseUrl: "https://base/1", filename: "one.jpg", mimeType: "image/jpeg" },
            },
          ],
          nextPageToken: "page2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          mediaItems: [
            {
              id: "m2",
              mimeType: "image/png",
              mediaFile: { baseUrl: "https://base/2", filename: "two.png", mimeType: "image/png" },
            },
            // no baseUrl -> skipped: nothing importable
            { id: "m3", mimeType: "image/jpeg", mediaFile: {} },
          ],
        }),
      );

    const items = await pollPickerSession(gdrive, "user-1", "session-1");
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ id: "m1", name: "one.jpg", baseUrl: "https://base/1" });
    expect(items?.[1]).toMatchObject({ id: "m2", name: "two.png", mimeType: "image/png" });

    // Second list call carried the page token. fetch was called with a URL
    // object, so compare its string form.
    const third = vi.mocked(fetch).mock.calls[2][0];
    expect(String(third)).toContain("pageToken=page2");
  });

  it("falls back to the item id as name when the filename is absent", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ mediaItemsSet: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          mediaItems: [
            { id: "m1", mediaFile: { baseUrl: "https://base/1" } },
          ],
        }),
      );
    const items = await pollPickerSession(gdrive, "user-1", "session-1");
    expect(items?.[0].name).toBe("m1");
  });

  it("stops paginating when the server echoes the same page token", async () => {
    // Guard against an infinite loop: a server that keeps returning the same
    // nextPageToken must not be followed forever. Use an implementation (not
    // mockResolvedValue) so each page response is a fresh, unconsumed body.
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes("/sessions/")) return jsonResponse({ mediaItemsSet: true });
      return jsonResponse({
        mediaItems: [
          { id: "m1", mimeType: "image/jpeg", mediaFile: { baseUrl: "https://b/1", filename: "a.jpg" } },
        ],
        nextPageToken: "loop",
      });
    });
    const items = await pollPickerSession(gdrive, "user-1", "session-1");
    expect(items).toHaveLength(2); // first page + one echoed page, then the guard fires
  });

  it("throws when the session lookup fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("nope", { status: 404 }));
    await expect(pollPickerSession(gdrive, "user-1", "session-1")).rejects.toThrow(/404/);
  });
});

describe("downloadPickedItem", () => {
  it("appends =d and authorizes with the user's token", async () => {
    const bytes = Buffer.from("jpeg-bytes");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(bytes, { status: 200 }));

    const result = await downloadPickedItem(gdrive, "user-1", {
      id: "m1",
      name: "one.jpg",
      mimeType: "image/jpeg",
      baseUrl: "https://base/1",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://base/1=d");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer picker-token",
    );
    expect(result.equals(bytes)).toBe(true);
  });

  it("throws on failed downloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("gone", { status: 410 }));
    await expect(
      downloadPickedItem(gdrive, "user-1", {
        id: "m1",
        name: "n",
        mimeType: "image/jpeg",
        baseUrl: "https://b",
      }),
    ).rejects.toThrow(/410/);
  });
});
