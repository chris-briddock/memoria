import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiSubmit } from "@/lib/api-submit";

// apiSubmit is the client-side counterpart of the form actions: it POSTs to an
// API route and normalises the response into { ok, error, data }. `fetch` is
// stubbed; these tests exercise the normalisation branches only.
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiSubmit", () => {
  it("POSTs JSON by default and returns the parsed body as data", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "a1", name: "Album" }));

    const result = await apiSubmit<{ id: string; name: string }>(
      "/api/albums",
      { body: JSON.stringify({ name: "Album" }) },
    );

    expect(result).toEqual({
      ok: true,
      error: null,
      data: { id: "a1", name: "Album" },
    });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/albums");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("lets FormData set its own multipart Content-Type", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await apiSubmit("/api/upload", {
      method: "POST",
      body: new FormData(),
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toBeUndefined();
  });

  it("honours an explicit method override", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiSubmit("/api/photos/p1/favorite", { method: "PUT" });

    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
  });

  it("returns the server's error message on a non-ok status", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: "An album with that name already exists." }),
    );

    const result = await apiSubmit("/api/albums", {});

    expect(result).toEqual({
      ok: false,
      error: "An album with that name already exists.",
      data: null,
    });
  });

  it("falls back to a generic message when the error body has no message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, null));

    const result = await apiSubmit("/api/albums", {});

    expect(result).toEqual({ ok: false, error: "Request failed.", data: null });
  });

  it("treats an ok status carrying an error field as a failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { error: "Invite code is invalid." }),
    );

    const result = await apiSubmit("/api/invites", {});

    expect(result).toEqual({
      ok: false,
      error: "Invite code is invalid.",
      data: null,
    });
  });

  it("returns null data for a successful but empty body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, null));

    const result = await apiSubmit("/api/photos/p1", { method: "DELETE" });

    expect(result).toEqual({ ok: true, error: null, data: null });
  });

  it("normalises network failures into an error result", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const result = await apiSubmit("/api/me");

    expect(result).toEqual({ ok: false, error: "Network error.", data: null });
  });
});
