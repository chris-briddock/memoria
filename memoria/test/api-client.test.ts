import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// apiGet reads the incoming request's headers and re-fetches the app's own API
// routes. Both `headers()` and `fetch` are mocked; no server is involved.
const { headers } = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers }));

import { apiGet, apiGetRequired } from "@/lib/api-client";

function headerStore(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return { get: (key: string) => map.get(key) ?? null };
}

function jsonResponse(status: number, body: unknown, init: { statusText?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: init.statusText,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  headers.mockReset();
  headers.mockResolvedValue(headerStore({ host: "example.test" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiGet", () => {
  it("fetches with the request's host and default http protocol", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "p1" }));

    const result = await apiGet<{ id: string }>("/api/photos/p1");

    expect(result).toEqual({ id: "p1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://example.test/api/photos/p1");
    expect(init).toMatchObject({ cache: "no-store", redirect: "manual" });
  });

  it("honours x-forwarded-proto and forwards the session cookie", async () => {
    headers.mockResolvedValue(
      headerStore({
        host: "memoria.example.com",
        "x-forwarded-proto": "https",
        cookie: "authjs.session-token=abc",
      }),
    );
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await apiGet("/api/photos");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://memoria.example.com/api/photos");
    expect((init?.headers as Record<string, string>).cookie).toBe(
      "authjs.session-token=abc",
    );
  });

  it("omits the cookie header when the request has none", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiGet("/api/me");

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toEqual({});
  });

  it("falls back to localhost:3000 when no host header is present", async () => {
    headers.mockResolvedValue(headerStore());
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiGet("/api/bootstrap");

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/api/bootstrap");
  });

  it("returns null for a 404 (missing resource, not an error)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: "not found" }));

    await expect(apiGet("/api/photos/nope")).resolves.toBeNull();
  });

  it("throws on a redirect (auth boundary), without following it", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { Location: "/signin" },
      }),
    );

    await expect(apiGet("/api/photos")).rejects.toThrow(
      "GET /api/photos redirected (unauthenticated): 307",
    );
  });

  it("throws with status and body for other failure statuses", async () => {
    fetchMock.mockResolvedValue(
      new Response("database down", { status: 500 }),
    );

    await expect(apiGet("/api/photos")).rejects.toThrow(
      "GET /api/photos failed: 500 database down",
    );
  });

  it("still throws when the error body cannot be read", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 502 }),
    );

    await expect(apiGet("/api/photos")).rejects.toThrow(
      "GET /api/photos failed: 502",
    );
  });
});

describe("apiGetRequired", () => {
  it("returns the body when the resource exists", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { photos: 3 }));

    await expect(apiGetRequired("/api/stats")).resolves.toEqual({ photos: 3 });
  });

  it("turns an unexpected 404 into a loud error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, null));

    await expect(apiGetRequired("/api/bootstrap")).rejects.toThrow(
      "GET /api/bootstrap returned an unexpected 404",
    );
  });

  it("propagates non-404 failures unchanged", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(apiGetRequired("/api/stats")).rejects.toThrow(
      "GET /api/stats failed: 500 nope",
    );
  });
});
